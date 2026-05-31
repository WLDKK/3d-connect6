import { useRef, useEffect } from "react";
import { useViewState } from "../hooks/useViewStore";
import { useGameSnapshot } from "../hooks/useGameStore";
import { Stone } from "@connect6/shared";

const CANVAS_SIZE = 200;

// Theme-aware color sets
const THEMES = {
  dark: {
    bg: "#0d1117",
    grid: "#1e2a3a",
    dot: "#2a3a4a",
    black: "#1a1a2e",
    blackGlow: "#4a90d9",
    white: "#e0e0e0",
    whiteGlow: "#ffffff",
    text: "#888",
    textDim: "#666",
  },
  light: {
    bg: "#f5f0e6",
    grid: "#b0a898",
    dot: "#887868",
    black: "#1a1a2e",
    blackGlow: "#4a90d9",
    white: "#e0e0e0",
    whiteGlow: "#ffffff",
    text: "#333",
    textDim: "#666",
  },
};

/**
 * 2D slice monitor. Right-hand Cartesian: X right, Y back, Z up.
 * User→grid: gx = Sx-1-ux, gy = uy, gz = uz.
 */
export function SliceMonitor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { sliceEnabled, sliceAxis, sliceIndex, theme } = useViewState();
  const snapshot = useGameSnapshot();
  const colors = THEMES[theme];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sliceEnabled) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { board, config } = snapshot;
    const { sizeX: Sx, sizeY: Sy, sizeZ: Sz } = config;

    let dimH: number, dimV: number, lh: string, lv: string;

    // Map screen (col, row) → grid coords.
    // Right-hand Cartesian: X=0 left (gx=Sx-1), X=9 right (gx=0) → gx = Sx-1-col
    //                       Y=0 near (gy=0),  Y=9 far  (gy=9) → gy = col (for Y axis) or sliceIndex
    //                       Z=0 bottom(gz=0), Z=9 top (gz=9)  → gz = Sz-1-row (canvas row 0 = top)
    const toGrid = (col: number, row: number) => {
      if (sliceAxis === "z") {
        // X=0 right (gx=Sx-1-col), Y=0 bottom (gy=Sy-1-row), Z=sliceIndex
        return { gx: Sx - 1 - col, gy: Sy - 1 - row, gz: sliceIndex };
      } else if (sliceAxis === "x") {
        return { gx: Sx - 1 - sliceIndex, gy: col, gz: Sz - 1 - row };
      } else {
        return { gx: Sx - 1 - col, gy: sliceIndex, gz: Sz - 1 - row };
      }
    };

    if (sliceAxis === "z") {
      dimH = Sx; dimV = Sy; lh = "X"; lv = "Y";
    } else if (sliceAxis === "x") {
      dimH = Sy; dimV = Sz; lh = "Y"; lv = "Z";
    } else {
      dimH = Sx; dimV = Sz; lh = "X"; lv = "Z";
    }

    const margin = 20;
    const avail = CANVAS_SIZE - margin * 2;
    const cell = Math.floor(avail / Math.max(dimH, dimV));
    const gridW = cell * dimH;
    const gridH = cell * dimV;
    const ox = margin + (avail - gridW) / 2;
    const oy = margin + (avail - gridH) / 2;

    // Clear
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Grid lines
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= dimH; i++) {
      ctx.beginPath(); ctx.moveTo(ox + i * cell, oy); ctx.lineTo(ox + i * cell, oy + gridH); ctx.stroke();
    }
    for (let j = 0; j <= dimV; j++) {
      ctx.beginPath(); ctx.moveTo(ox, oy + j * cell); ctx.lineTo(ox + gridW, oy + j * cell); ctx.stroke();
    }

    // Draw cells
    const stoneR = cell * 0.35;
    for (let col = 0; col < dimH; col++) {
      for (let row = 0; row < dimV; row++) {
        const { gx, gy, gz } = toGrid(col, row);
        const stone = board[gz * Sy * Sx + gy * Sx + gx];

        const cx = ox + (col + 0.5) * cell;
        const cy = oy + (row + 0.5) * cell;

        if (stone === Stone.EMPTY) {
          ctx.fillStyle = colors.dot;
          ctx.beginPath(); ctx.arc(cx, cy, 1.5, 0, Math.PI * 2); ctx.fill();
          continue;
        }

        const isBlack = stone === Stone.BLACK;
        ctx.shadowColor = isBlack ? colors.blackGlow : colors.whiteGlow;
        ctx.shadowBlur = 4;
        ctx.fillStyle = isBlack ? colors.black : colors.white;
        ctx.beginPath(); ctx.arc(cx, cy, stoneR, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = isBlack ? "rgba(74,144,217,0.3)" : "rgba(255,255,255,0.3)";
        ctx.beginPath(); ctx.arc(cx - stoneR * 0.25, cy - stoneR * 0.25, stoneR * 0.4, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Horizontal tick labels: 0,1,...,dimH-1 left to right
    ctx.shadowBlur = 0;
    ctx.fillStyle = colors.text;
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    for (let i = 0; i < dimH; i++) {
      ctx.fillText(String(i), ox + (i + 0.5) * cell, oy + gridH + 12);
    }
    // Vertical tick labels
    ctx.textAlign = "right";
    if (sliceAxis === "z") {
      // Y=0 at bottom (row=dimV-1), Y=9 at top (row=0) — labels count 9,8,...,0 top to bottom
      for (let i = 0; i < dimV; i++) {
        ctx.fillText(String(dimV - 1 - i), ox - 4, oy + (i + 0.5) * cell + 3);
      }
    } else {
      // Z=0 at bottom (row=dimV-1), Z=9 at top (row=0) — labels count 9,8,...,0 top to bottom
      for (let i = 0; i < dimV; i++) {
        ctx.fillText(String(dimV - 1 - i), ox - 4, oy + (i + 0.5) * cell + 3);
      }
    }

    // Axis name labels
    ctx.fillStyle = colors.textDim;
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(lh, ox + gridW / 2, CANVAS_SIZE - 3);
    ctx.save();
    ctx.translate(7, oy + gridH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(lv, 0, 0);
    ctx.restore();

  }, [sliceEnabled, sliceAxis, sliceIndex, snapshot]);

  if (!sliceEnabled) return null;

  return (
    <div className="pointer-events-none select-none">
      <div className="bg-black/70 backdrop-blur-sm border border-cyber-grid rounded-lg p-2">
        <div className="text-cyber-accent text-[10px] font-mono mb-1 text-center">
          {sliceAxis.toUpperCase()} = {sliceIndex}
        </div>
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          className="rounded"
          style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
        />
      </div>
    </div>
  );
}
