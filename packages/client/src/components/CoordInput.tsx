import { useState, useCallback, useEffect, useRef } from "react";
import { Stone } from "@connect6/shared";
import { useGameSnapshot, useGameActions } from "../hooks/useGameStore";

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
  disabled?: boolean;
  disabledReason?: string;
}

export function CoordInput({ onPreview, disabled = false, disabledReason = "" }: CoordInputProps) {
  const snapshot = useGameSnapshot();
  const { placeStone } = useGameActions();
  const { sizeX, sizeY, sizeZ } = snapshot.config;

  const [input, setInput] = useState("");
  const [error, setError] = useState("");
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

  const updatePreview = useCallback((ux: number, uy: number, uz: number) => {
    const g = toGrid(ux, uy, uz);
    if (disabled) {
      onPreview(null);
      setError(disabledReason || "当前不可落子");
      return false;
    }
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
  }, [disabled, disabledReason, toGrid, isOccupied, snapshot.winner, onPreview]);

  const moveCursor = useCallback((dx: number, dy: number, dz: number) => {
    const c = cursorRef.current;
    const nx = clamp(c.x + dx, sizeX);
    const ny = clamp(c.y + dy, sizeY);
    const nz = clamp(c.z + dz, sizeZ);
    cursorRef.current = { x: nx, y: ny, z: nz };
    setInput(`${nx},${ny},${nz}`);
    updatePreview(nx, ny, nz);
    setError("");
  }, [sizeX, sizeY, sizeZ, updatePreview]);

  const handleSubmit = useCallback(() => {
    setError("");
    if (disabled) {
      setError(disabledReason || "当前不可落子");
      return;
    }
    const parsed = parseUserCoords(input);
    if (!parsed) {
      setError("请输入有效坐标，如 4,5,5");
      return;
    }
    const [ux, uy, uz] = parsed;
    if (ux < 0 || ux >= sizeX || uy < 0 || uy >= sizeY || uz < 0 || uz >= sizeZ) {
      setError(`坐标范围：0-${sizeX - 1}, 0-${sizeY - 1}, 0-${sizeZ - 1}`);
      return;
    }
    const c = { x: ux, y: uy, z: uz };
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

    setInput("");
    onPreview(null);
    if (!placeStone(g.x, g.y, g.z)) setError("此处无法落子");
  }, [disabled, disabledReason, input, snapshot, sizeX, sizeY, sizeZ, toGrid, placeStone, onPreview]);

  submitRef.current = handleSubmit;

  // Global keyboard — capture phase
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (disabled) return;
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
  }, [disabled, moveCursor]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    setError("");

    const parsed = parseUserCoords(val);
    if (!parsed) {
      onPreview(null);
      if (val.trim()) setError("格式示例：4,5,5");
      return;
    }
    const [ux, uy, uz] = parsed;
    if (ux >= 0 && ux < sizeX && uy >= 0 && uy < sizeY && uz >= 0 && uz < sizeZ) {
      cursorRef.current = { x: ux, y: uy, z: uz };
      updatePreview(ux, uy, uz);
    } else {
      onPreview(null);
      setError("坐标超出棋盘范围");
    }
  }, [onPreview, sizeX, sizeY, sizeZ, updatePreview]);

  return (
    <div className="coord-input absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-xs w-[min(92vw,560px)]">
      <div className="surface-panel rounded-xl px-3 py-2 flex flex-wrap items-center justify-center gap-2 shadow-2xl">
        <span className="text-cyber-accent opacity-70">坐标</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={handleChange}
          placeholder="x,y,z"
          aria-label="落子坐标"
          disabled={disabled}
          className="bg-cyber-grid/50 text-white px-2 py-1 rounded w-28 outline-none border border-transparent focus:border-cyber-accent text-center"
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || input.trim().length === 0}
          className="px-3 py-1 bg-cyber-accent/20 text-cyber-accent rounded hover:bg-cyber-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          落子
        </button>
        {error && <span className="text-red-400 ml-1" role="alert">{error}</span>}
        {disabled && !error && <span className="text-cyber-accent/50 ml-1">{disabledReason}</span>}
        <span className="text-cyber-accent/30 ml-2 hidden md:inline">
          ←→左右 ↑↓前后 PgUp/PgDn上下 Enter确认
        </span>
      </div>
    </div>
  );
}
