import { useState, useCallback, useRef } from "react";
import {
  computeAiMove, scoreCell,
  Player, Stone, type Direction,
  type AiRequestPayload, type BoardConfig,
} from "@connect6/shared";
import { useGameSnapshot } from "../hooks/useGameStore";
import { useViewState } from "../hooks/useViewStore";
import { API_BASE } from "../config";

// Re-export DIRECTIONS from engine (same as shared/engine.ts)
const DIRECTIONS: readonly Direction[] = [
  { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 },
  { x: 1, y: 1, z: 0 }, { x: 1, y: -1, z: 0 },
  { x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: -1 },
  { x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: -1 },
  { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: -1 },
  { x: 1, y: -1, z: 1 }, { x: 1, y: -1, z: -1 },
];

function inBounds(x: number, y: number, z: number, c: BoardConfig) {
  return x >= 0 && x < c.sizeX && y >= 0 && y < c.sizeY && z >= 0 && z < c.sizeZ;
}

/**
 * Explain WHY a move at (x,y,z) is good — what lines it creates or blocks.
 */
/**
 * Analyze a line through (x,y,z) in direction `dir` for `color`,
 * treating (x,y,z) as if it were occupied by `color`.
 * Counts consecutive stones and handles gap patterns.
 * Returns { count, openEnds } — count includes the cell itself.
 */
function analyzeLineThrough(
  board: number[], config: BoardConfig,
  x: number, y: number, z: number,
  dir: Direction, color: Stone,
): { count: number; openEnds: number } {
  // Walk forward from (x+dir)
  let fwd = 0, fwdOpen = false;
  let cx = x + dir.x, cy = y + dir.y, cz = z + dir.z;
  while (inBounds(cx, cy, cz, config) && board[cz * config.sizeY * config.sizeX + cy * config.sizeX + cx] === color) {
    fwd++;
    cx += dir.x; cy += dir.y; cz += dir.z;
  }
  fwdOpen = inBounds(cx, cy, cz, config) && board[cz * config.sizeY * config.sizeX + cy * config.sizeX + cx] === Stone.EMPTY;

  // Walk backward from (x-dir)
  const nd = { x: -dir.x, y: -dir.y, z: -dir.z };
  let rev = 0, revOpen = false;
  cx = x + nd.x; cy = y + nd.y; cz = z + nd.z;
  while (inBounds(cx, cy, cz, config) && board[cz * config.sizeY * config.sizeX + cy * config.sizeX + cx] === color) {
    rev++;
    cx += nd.x; cy += nd.y; cz += nd.z;
  }
  revOpen = inBounds(cx, cy, cz, config) && board[cz * config.sizeY * config.sizeX + cy * config.sizeX + cx] === Stone.EMPTY;

  const count = 1 + fwd + rev;
  const openEnds = (fwdOpen ? 1 : 0) + (revOpen ? 1 : 0);
  return { count, openEnds };
}

function explainMove(
  board: number[], config: BoardConfig,
  x: number, y: number, z: number,
  myStone: Stone, oppStone: Stone,
): string {
  const reasons: string[] = [];
  const { winLength } = config;

  for (const dir of DIRECTIONS) {
    // Analyze as if placing my stone at (x,y,z)
    const my = analyzeLineThrough(board, config, x, y, z, dir, myStone);
    // Analyze opponent's line through this cell (defensive value)
    const opp = analyzeLineThrough(board, config, x, y, z, dir, oppStone);

    // Offensive
    if (my.count >= winLength) {
      reasons.push(`✅ 完成 ${my.count} 连！直接获胜`);
    } else if (my.count === winLength - 1 && my.openEnds >= 1) {
      reasons.push(`🎯 形成 ${my.count} 连${my.openEnds === 2 ? "（双开）" : "（单开）"}，下一步可赢`);
    } else if (my.count >= 3 && my.openEnds === 2) {
      reasons.push(`📈 建立 ${my.count} 连开放线`);
    }

    // Defensive
    if (opp.count >= winLength) {
      reasons.push(`🚨 堵住对手 ${opp.count} 连！阻止对手获胜`);
    } else if (opp.count === winLength - 1 && opp.openEnds >= 1) {
      reasons.push(`🛡️ 堵住对手 ${opp.count} 连${opp.openEnds === 2 ? "（双开威胁）" : "（单开威胁）"}`);
    } else if (opp.count >= 3 && opp.openEnds === 2) {
      reasons.push(`🛡️ 堵住对手 ${opp.count} 连开放线`);
    }
  }

  // Center bonus note
  const cx = (config.sizeX - 1) / 2, cy = (config.sizeY - 1) / 2, cz = (config.sizeZ - 1) / 2;
  const dist = Math.abs(x - cx) / config.sizeX + Math.abs(y - cy) / config.sizeY + Math.abs(z - cz) / config.sizeZ;
  if (dist < 0.3 && reasons.length === 0) {
    reasons.push("📍 中心位置，参与更多方向");
  }

  if (reasons.length === 0) reasons.push("📋 扩展棋路");
  return reasons[0]; // Return the most important reason
}


interface Analysis {
  bestMove: { x: number; y: number; z: number } | null;
  bestMoveReason: string;
  threats: string[];
  source: "llm" | "local";
  llmText?: string;
}

/** Score thresholds */
const SCORE = {
  WIN: 500000,
  OPEN5: 50000,
  OPEN4: 1200,
  OPEN3: 100,
};

function analyzeThreats(board: number[], config: BoardConfig, aiStone: Stone): string[] {
  const { sizeX: sx, sizeY: sy, sizeZ: sz } = config;
  const oppStone = aiStone === Stone.BLACK ? Stone.WHITE : Stone.BLACK;
  const lines: string[] = [];

  let myWins = 0, oppWins = 0;
  let myOpen5 = 0, oppOpen5 = 0;
  let myOpen4 = 0, oppOpen4 = 0;

  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        if (board[z * sy * sx + y * sx + x] !== Stone.EMPTY) continue;
        const myScore = scoreCell(board, config, x, y, z, aiStone);
        const oppScore = scoreCell(board, config, x, y, z, oppStone);
        if (myScore >= SCORE.WIN) myWins++;
        if (oppScore >= SCORE.WIN) oppWins++;
        if (myScore >= SCORE.OPEN5 && myScore < SCORE.WIN) myOpen5++;
        if (oppScore >= SCORE.OPEN5 && oppScore < SCORE.WIN) oppOpen5++;
        if (myScore >= SCORE.OPEN4 && myScore < SCORE.OPEN5) myOpen4++;
        if (oppScore >= SCORE.OPEN4 && oppScore < SCORE.OPEN5) oppOpen4++;
      }
    }
  }

  if (oppWins > 0) lines.push(`🚨 对手下一步可胜！必须堵住`);
  if (myWins > 0) lines.push(`✅ 你下一步可胜！直接赢棋`);
  if (oppOpen5 > 0) lines.push(`⚠️ 对手有 ${oppOpen5} 个差一子的威胁`);
  if (myOpen5 > 0) lines.push(`🎯 你有 ${myOpen5} 个差一子的机会`);
  if (myOpen4 >= 2) lines.push(`💪 你有 ${myOpen4} 条开放四，双威胁机会`);
  if (oppOpen4 >= 2) lines.push(`🛡️ 对手有 ${oppOpen4} 条开放四，注意防守`);
  if (lines.length === 0) lines.push("📋 局势平稳，构建开放线");

  return lines;
}

/**
 * Call LLM server for analysis.
 */
async function callLLMAnalysis(snapshot: {
  board: number[];
  config: BoardConfig;
  currentPlayer: number;
  round: number;
  stonesPlacedThisTurn: number;
}): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(`${API_BASE}/api/ai/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        board: Array.from(snapshot.board),
        config: snapshot.config,
        aiColor: snapshot.currentPlayer,
        currentPlayer: snapshot.currentPlayer,
        stonesToPlace: snapshot.round === 0 ? 1 : 2 - snapshot.stonesPlacedThisTurn,
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json() as { text?: string };
    return data.text || null;
  } catch {
    return null;
  }
}

export function TrainingAnalysis() {
  const snapshot = useGameSnapshot();
  const { theme } = useViewState();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);

  const isDark = theme === "dark";
  const bgPanel = isDark ? "bg-black/70" : "bg-white/80";
  const borderColor = isDark ? "border-cyber-grid" : "border-gray-300";
  const textColor = isDark ? "text-cyan-300" : "text-blue-700";
  const textDim = isDark ? "text-gray-400" : "text-gray-500";

  const analyze = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setAnalysis(null);

    const board = Array.from(snapshot.board);
    const { config, currentPlayer } = snapshot;
    const aiStone = currentPlayer as unknown as Stone;
    const oppStone = aiStone === Stone.BLACK ? Stone.WHITE : Stone.BLACK;

    // Step 1: Threat analysis
    const threats = analyzeThreats(board, config, aiStone);

    // Step 2: Find best local move and explain WHY
    const req: AiRequestPayload = {
      board,
      config,
      aiColor: currentPlayer,
      currentPlayer,
      stonesToPlace: snapshot.round === 0 ? 1 : 2 - snapshot.stonesPlacedThisTurn,
      model: "local",
    };
    const localResult = computeAiMove(req);
    let bestMove: { x: number; y: number; z: number } | null = null;
    let bestMoveReason = "无可用着法";

    if (localResult.moves.length > 0) {
      bestMove = localResult.moves[0];
      bestMoveReason = explainMove(board, config, bestMove.x, bestMove.y, bestMove.z, aiStone, oppStone);
    }

    setAnalysis({
      bestMove,
      bestMoveReason,
      threats,
      source: "local",
    });

    // Step 3: Try LLM analysis
    const llmResult = await callLLMAnalysis(snapshot);
    if (llmResult) {
      setAnalysis(prev => prev ? { ...prev, llmText: llmResult, source: "llm" } : prev);
    }
    setLoading(false);
  }, [snapshot, loading]);

  if (snapshot.winner !== Stone.EMPTY) return null;

  return (
    <div className="pointer-events-auto">
      <div className={`${bgPanel} backdrop-blur-sm border ${borderColor} rounded-lg p-3 w-64`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`${textColor} text-xs font-mono font-bold`}>🔬 训练分析</span>
          <button
            onClick={analyze}
            disabled={loading}
            className={`px-2 py-0.5 text-[10px] font-mono rounded ${isDark ? "bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30" : "bg-blue-500/15 text-blue-700 hover:bg-blue-500/25"} transition-colors disabled:opacity-50`}
          >
            {loading ? "分析中..." : "分析"}
          </button>
        </div>

        {analysis ? (
          <div className="space-y-2 text-[11px] font-mono">
            {/* Threats */}
            {analysis.threats.map((t, i) => (
              <p key={i} className={i === 0 && t.includes("🚨") ? "text-red-400 font-bold" : textDim}>{t}</p>
            ))}

            {/* Best move with reason */}
            <div className={`mt-2 p-2 rounded ${isDark ? "bg-white/5" : "bg-black/5"}`}>
              <p className={`${textColor} font-bold`}>
                推荐下在: {analysis.bestMove
                  ? `(${analysis.bestMove.x}, ${analysis.bestMove.y}, ${analysis.bestMove.z})`
                  : "无"}
              </p>
              <p className={`${textDim} mt-1`}>{analysis.bestMoveReason}</p>
            </div>

            {/* LLM deep analysis */}
            {analysis.llmText && (
              <div className={`mt-2 p-2 rounded ${isDark ? "bg-white/5" : "bg-black/5"}`}>
                <p className={`${textColor} text-[10px] font-bold mb-1`}>☁️ 深度分析</p>
                <p className={`${textDim} leading-relaxed text-[10px]`}>{analysis.llmText}</p>
              </div>
            )}

            {/* Source */}
            <p className={`text-[9px] ${textDim}`}>
              {analysis.source === "llm" ? "☁️ LLM 分析" : "💻 本地分析"}
              {loading && " · 深度分析加载中..."}
            </p>
          </div>
        ) : (
          <p className={`text-[11px] font-mono ${textDim}`}>
            点击"分析"获取 AI 局势评估
          </p>
        )}
      </div>
    </div>
  );
}
