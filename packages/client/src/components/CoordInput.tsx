import { useState, useCallback, useEffect, useRef } from "react";
import { Player, Stone, type AiRequestPayload } from "@connect6/shared";
import { useGameSnapshot, useGameActions } from "../hooks/useGameStore";
import { useAiWorker } from "../hooks/useAiWorker";

/**
 * Camera-relative directions for keyboard navigation.
 * Updated every frame by CameraDirectionTracker inside the Canvas.
 */
export const cameraDir = {
  forward: { x: 0, y: 1, z: 0 },  // default: into screen
  right: { x: 1, y: 0, z: 0 },    // default: right
};

/**
 * Coordinate input with camera-relative keyboard navigation.
 *
 * Key mapping (always relative to current camera view):
 *   ← → : move left / right  (camera right vector)
 *   ↑ ↓ : move up / down     (world Z axis)
 *   W   : move forward (into screen from current view)
 *   S   : move backward (toward camera)
 *   Enter: confirm and place stone
 */

function parseUserCoords(raw: string): [number, number, number] | null {
  const trimmed = raw.trim();
  let parts: number[];
  if (/^\d{3}$/.test(trimmed)) {
    parts = trimmed.split("").map(Number);
  } else {
    parts = trimmed.split(/[,，\s]+/).filter(Boolean).map((s) => parseInt(s, 10));
  }
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return [parts[0], parts[1], parts[2]];
}

function clamp(v: number, max: number): number {
  return Math.max(0, Math.min(max - 1, v));
}

interface CoordInputProps {
  onPreview: (coords: { x: number; y: number; z: number } | null) => void;
}

export function CoordInput({ onPreview }: CoordInputProps) {
  const snapshot = useGameSnapshot();
  const { placeStone } = useGameActions();
  const { sizeX, sizeY, sizeZ } = snapshot.config;
  const { compute: computeAi } = useAiWorker();

  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [aiComputing, setAiComputing] = useState(false);
  const cursorRef = useRef({ x: 0, y: 0, z: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<() => void>(() => {});

  const toGrid = useCallback((ux: number, uy: number, uz: number) => ({
    x: sizeX - 1 - ux, y: uy, z: uz,
  }), [sizeX]);

  const isOccupied = useCallback((gx: number, gy: number, gz: number) => {
    const idx = gz * sizeY * sizeX + gy * sizeX + gx;
    return snapshot.board[idx] !== Stone.EMPTY;
  }, [snapshot.board, sizeX, sizeY]);

  // Compute AI best move via Web Worker — main thread stays free
  useEffect(() => {
    if (manualMode) return;
    if (snapshot.winner !== Stone.EMPTY) return;

    const stonesToPlace = snapshot.round === 0 ? 1 : 2 - snapshot.stonesPlacedThisTurn;
    if (stonesToPlace <= 0) return;

    let cancelled = false;
    setAiComputing(true);

    const req: AiRequestPayload = {
      board: Array.from(snapshot.board),
      config: snapshot.config,
      aiColor: snapshot.currentPlayer as Player,
      currentPlayer: snapshot.currentPlayer as Player,
      stonesToPlace,
      model: "local",
    };

    computeAi(req).then((result) => {
      if (cancelled) return;
      if (result.moves.length > 0) {
        const m = result.moves[0];
        const ux = sizeX - 1 - m.x;
        const uy = m.y;
        const uz = m.z;
        cursorRef.current = { x: ux, y: uy, z: uz };
        setInput(`${ux},${uy},${uz}`);
        onPreview(toGrid(ux, uy, uz));
      }
      setAiComputing(false);
    });

    return () => { cancelled = true; setAiComputing(false); };
  }, [snapshot.currentPlayer, snapshot.round, snapshot.stonesPlacedThisTurn, snapshot.board, manualMode, sizeX]);

  const updatePreview = useCallback((ux: number, uy: number, uz: number) => {
    const g = toGrid(ux, uy, uz);
    if (snapshot.winner !== Stone.EMPTY) {
      onPreview(null);
      setError("游戏已结束");
      return false;
    }
    if (isOccupied(g.x, g.y, g.z)) {
      onPreview(null);
      setError("该位置已有棋子");
      return false;
    }
    setError("");
    onPreview(g);
    return true;
  }, [toGrid, isOccupied, snapshot.winner, onPreview]);

  const moveCursor = useCallback((dx: number, dy: number, dz: number) => {
    const c = cursorRef.current;
    const nx = clamp(c.x + dx, sizeX);
    const ny = clamp(c.y + dy, sizeY);
    const nz = clamp(c.z + dz, sizeZ);
    cursorRef.current = { x: nx, y: ny, z: nz };
    setInput(`${nx},${ny},${nz}`);
    updatePreview(nx, ny, nz);
    setManualMode(false);
    setError("");
  }, [sizeX, sizeY, sizeZ, updatePreview]);

  const handleSubmit = useCallback(() => {
    setError("");
    const c = cursorRef.current;
    const g = toGrid(c.x, c.y, c.z);
    const idx = g.z * sizeY * sizeX + g.y * sizeX + g.x;

    if (snapshot.winner !== Stone.EMPTY) {
      setError("游戏已结束");
      return;
    }
    if (snapshot.board[idx] !== Stone.EMPTY) {
      setError("该位置已有棋子");
      return;
    }

    // Reset manual mode BEFORE placing stone so the AI suggestion effect
    // sees manualMode=false when it fires after the snapshot update
    setManualMode(false);
    setInput("");
    onPreview(null);
    placeStone(g.x, g.y, g.z);
  }, [snapshot, sizeY, sizeX, toGrid, placeStone, onPreview]);

  submitRef.current = handleSubmit;

  // Global keyboard — capture phase
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isOurInput = document.activeElement === inputRef.current;
      const isOtherInput = (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") && !isOurInput;
      if (isOtherInput) return;

      let dx = 0, dy = 0, dz = 0;

      switch (e.key) {
        // ← → : left / right on screen (X axis)
        // cameraDir.right = camera's right direction projected to XY
        // User X increasing = right on screen
        case "ArrowLeft": {
          const r = cameraDir.right;
          dx = -Math.round(r.x);
          dy = -Math.round(r.y);
          break;
        }
        case "ArrowRight": {
          const r = cameraDir.right;
          dx = Math.round(r.x);
          dy = Math.round(r.y);
          break;
        }
        // ↑ ↓ : forward / backward (camera forward direction)
        case "ArrowUp": {
          const f = cameraDir.forward;
          dx = Math.round(f.x);
          dy = Math.round(f.y);
          break;
        }
        case "ArrowDown": {
          const f = cameraDir.forward;
          dx = -Math.round(f.x);
          dy = -Math.round(f.y);
          break;
        }
        // PageUp/PageDown: Z axis (up/down)
        case "PageUp":
          dz = 1;
          break;
        case "PageDown":
          dz = -1;
          break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          submitRef.current();
          return;
        default:
          return;
      }

      if (dx === 0 && dy === 0 && dz === 0) return;

      e.preventDefault();
      e.stopPropagation();
      moveCursor(dx, dy, dz);
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [moveCursor]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    setManualMode(true);
    setError("");

    const parsed = parseUserCoords(val);
    if (parsed) {
      const [ux, uy, uz] = parsed;
      if (ux >= 0 && ux < sizeX && uy >= 0 && uy < sizeY && uz >= 0 && uz < sizeZ) {
        cursorRef.current = { x: ux, y: uy, z: uz };
        updatePreview(ux, uy, uz);
      }
    }
  }, [sizeX, sizeY, sizeZ, updatePreview]);

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-xs">
      <div className="bg-black/70 backdrop-blur-sm border border-cyber-grid rounded-lg px-4 py-2 flex items-center gap-2">
        <span className="text-cyber-accent opacity-70">坐标</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={handleChange}
          placeholder="x,y,z"
          className="bg-cyber-grid/50 text-white px-2 py-1 rounded w-28 outline-none border border-transparent focus:border-cyber-accent text-center"
        />
        <button
          onClick={handleSubmit}
          className="px-3 py-1 bg-cyber-accent/20 text-cyber-accent rounded hover:bg-cyber-accent/30 transition-colors"
        >
          落子
        </button>
        {error && <span className="text-red-400 ml-1">{error}</span>}
        {aiComputing && !manualMode && <span className="text-yellow-400/60 ml-1">思考中...</span>}
        <span className="text-cyber-accent/30 ml-2 hidden md:inline">
          ←→左右 ↑↓前后 PgUp/PgDn上下 Enter确认
        </span>
      </div>
    </div>
  );
}
