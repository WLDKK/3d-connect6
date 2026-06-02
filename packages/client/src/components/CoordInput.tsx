import { useState, useCallback, useEffect, useRef } from "react";
import { computeAiMove, Player, Stone, type AiRequestPayload } from "@connect6/shared";
import { useGameSnapshot, useGameActions } from "../hooks/useGameStore";

/**
 * Coordinate input with keyboard navigation.
 *
 * When input is empty:
 *   - AI best move is computed and shown as preview
 *   - Arrow keys / W/S move the cursor
 *   - Enter confirms placement
 *
 * Key mapping (human perspective, facing the board):
 *   ← → : move left / right  (X axis)
 *   ↑ ↓ : move up / down     (Z axis)
 *   W   : move forward (into screen, away from you)  (Y+)
 *   S   : move backward (toward you)                  (Y-)
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

  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [manualMode, setManualMode] = useState(false);
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

  // Compute AI best move as initial cursor position
  useEffect(() => {
    if (manualMode) return;
    if (snapshot.winner !== Stone.EMPTY) return;

    const req: AiRequestPayload = {
      board: Array.from(snapshot.board),
      config: snapshot.config,
      aiColor: snapshot.currentPlayer as Player,
      currentPlayer: snapshot.currentPlayer as Player,
      stonesToPlace: snapshot.round === 0 ? 1 : 2 - snapshot.stonesPlacedThisTurn,
      model: "local",
    };

    const result = computeAiMove(req);
    if (result.moves.length > 0) {
      const m = result.moves[0];
      const ux = sizeX - 1 - m.x;
      const uy = m.y;
      const uz = m.z;
      cursorRef.current = { x: ux, y: uy, z: uz };
      setInput(`${ux},${uy},${uz}`);
      onPreview(toGrid(ux, uy, uz));
    }
  }, [snapshot.currentPlayer, snapshot.round, snapshot.stonesPlacedThisTurn, manualMode]);

  const updatePreview = useCallback((ux: number, uy: number, uz: number) => {
    const g = toGrid(ux, uy, uz);
    if (isOccupied(g.x, g.y, g.z) || snapshot.winner !== Stone.EMPTY) {
      onPreview(null);
      return false;
    }
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

  // Submit: place stone at current cursor position
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

    placeStone(g.x, g.y, g.z);
    setInput("");
    setManualMode(false);
    onPreview(null);
  }, [snapshot, sizeY, sizeX, toGrid, placeStone, onPreview]);

  submitRef.current = handleSubmit;

  // Global keyboard — capture phase, fires before OrbitControls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't interfere with other inputs (unless it's our own)
      const target = e.target as HTMLElement;
      const isOurInput = document.activeElement === inputRef.current;
      const isOtherInput = (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") && !isOurInput;
      if (isOtherInput) return;

      // Direction mapping (human perspective, facing the board):
      // ← → : left / right  (X)
      // ↑ ↓ : up / down     (Z)
      // W/S : forward / backward into screen (Y)
      let dx = 0, dy = 0, dz = 0;
      switch (e.key) {
        case "ArrowLeft":   dx = -1; break;
        case "ArrowRight":  dx = 1;  break;
        case "ArrowUp":     dz = 1;  break;
        case "ArrowDown":   dz = -1; break;
        case "w": case "W": dy = 1;  break;
        case "s": case "S": dy = -1; break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          submitRef.current();
          return;
        default:
          return; // Let other keys pass through
      }

      e.preventDefault();
      e.stopPropagation();
      moveCursor(dx, dy, dz);
    };

    window.addEventListener("keydown", handler, true); // capture phase
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
        <span className="text-cyber-accent/30 ml-2 hidden md:inline">
          ←→X ↑↓Z W·S 前后 Enter确认
        </span>
      </div>
    </div>
  );
}
