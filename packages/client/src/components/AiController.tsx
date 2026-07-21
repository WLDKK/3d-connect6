import { useEffect, useRef } from "react";
import { Player, Stone, type AiRequestPayload } from "@connect6/shared";
import { useGameSnapshot, useGameActions } from "../hooks/useGameStore";
import { useAiWorker } from "../hooks/useAiWorker";

interface AiControllerProps {
  aiColor: Player;
  onThinking?: (thinking: boolean) => void;
}

function fallbackMoves(request: AiRequestPayload) {
  const { board, config, stonesToPlace } = request;
  const cx = (config.sizeX - 1) / 2;
  const cy = (config.sizeY - 1) / 2;
  const cz = (config.sizeZ - 1) / 2;
  const empty = [];
  for (let z = 0; z < config.sizeZ; z++) {
    for (let y = 0; y < config.sizeY; y++) {
      for (let x = 0; x < config.sizeX; x++) {
        const index = z * config.sizeY * config.sizeX + y * config.sizeX + x;
        if (board[index] === Stone.EMPTY) empty.push({ x, y, z });
      }
    }
  }
  empty.sort((a, b) => {
    const da = Math.abs(a.x - cx) + Math.abs(a.y - cy) + Math.abs(a.z - cz);
    const db = Math.abs(b.x - cx) + Math.abs(b.y - cy) + Math.abs(b.z - cz);
    return da - db || a.z - b.z || a.y - b.y || a.x - b.x;
  });
  return empty.slice(0, stonesToPlace);
}

/** Drives the deterministic local engine without any network dependency. */
export function AiController({ aiColor, onThinking }: AiControllerProps) {
  const snapshot = useGameSnapshot();
  const { placeStone } = useGameActions();
  const { compute } = useAiWorker();
  const busyRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    if (snapshot.winner !== Stone.EMPTY) return;
    if (snapshot.board.every((stone) => stone !== Stone.EMPTY)) return;
    if (snapshot.currentPlayer !== aiColor || busyRef.current) return;

    const stonesToPlace = snapshot.round === 0 ? 1 : 2 - snapshot.stonesPlacedThisTurn;
    if (stonesToPlace <= 0) return;

    const request: AiRequestPayload = {
      board: Array.from(snapshot.board),
      config: snapshot.config,
      aiColor,
      currentPlayer: snapshot.currentPlayer as Player,
      stonesToPlace,
    };

    busyRef.current = true;
    const generation = ++generationRef.current;
    onThinking?.(true);

    compute(request).catch(() => ({ moves: fallbackMoves(request) })).then((result) => {
      if (generationRef.current !== generation) return;
      for (const move of result.moves) placeStone(move.x, move.y, move.z);
    }).finally(() => {
      if (generationRef.current !== generation) return;
      busyRef.current = false;
      onThinking?.(false);
    });

    return () => {
      if (generationRef.current !== generation) return;
      generationRef.current++;
      busyRef.current = false;
      onThinking?.(false);
    };
  }, [aiColor, compute, onThinking, placeStone, snapshot]);

  return null;
}
