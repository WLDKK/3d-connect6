import { useState, useCallback, useRef } from "react";
import {
  scoreCell,
  Player, Stone, type Direction,
  type AiRequestPayload, type BoardConfig,
} from "@connect6/shared";
import { useGameSnapshot } from "../hooks/useGameStore";
import { useViewState } from "../hooks/useViewStore";
import { useAiWorker } from "../hooks/useAiWorker";

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
      reasons.push(`制胜：完成 ${my.count} 连`);
    } else if (my.count === winLength - 1 && my.openEnds >= 1) {
      reasons.push(`进攻：形成 ${my.count} 连${my.openEnds === 2 ? "（双开）" : "（单开）"}，下一步可胜`);
    } else if (my.count >= 3 && my.openEnds === 2) {
      reasons.push(`布局：建立 ${my.count} 连开放线`);
    }

    // Defensive
    if (opp.count >= winLength) {
      reasons.push(`防守：封堵对手 ${opp.count} 连制胜点`);
    } else if (opp.count === winLength - 1 && opp.openEnds >= 1) {
      reasons.push(`防守：封堵对手 ${opp.count} 连${opp.openEnds === 2 ? "（双开威胁）" : "（单开威胁）"}`);
    } else if (opp.count >= 3 && opp.openEnds === 2) {
      reasons.push(`防守：压制对手 ${opp.count} 连开放线`);
    }
  }

  // Center bonus note
  const cx = (config.sizeX - 1) / 2, cy = (config.sizeY - 1) / 2, cz = (config.sizeZ - 1) / 2;
  const dist = Math.abs(x - cx) / config.sizeX + Math.abs(y - cy) / config.sizeY + Math.abs(z - cz) / config.sizeZ;
  if (dist < 0.3 && reasons.length === 0) {
    reasons.push("布局：中心位置拥有更多延展方向");
  }

  if (reasons.length === 0) reasons.push("布局：扩展可用棋路");
  return reasons[0]; // Return the most important reason
}


interface Analysis {
  positionId: string;
  bestMove: { x: number; y: number; z: number } | null;
  bestMoveReason: string;
  threats: string[];
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

  if (oppWins > 0) lines.push("紧急：对手下一步可胜，必须封堵");
  if (myWins > 0) lines.push("制胜：当前存在直接胜点");
  if (oppOpen5 > 0) lines.push(`警戒：对手有 ${oppOpen5} 个差一子的威胁`);
  if (myOpen5 > 0) lines.push(`机会：当前有 ${myOpen5} 个差一子的落点`);
  if (myOpen4 >= 2) lines.push(`进攻：已有 ${myOpen4} 条开放四，可构造双威胁`);
  if (oppOpen4 >= 2) lines.push(`防守：对手有 ${oppOpen4} 条开放四`);
  if (lines.length === 0) lines.push("局势平稳，优先构建开放线");

  return lines;
}

export function TrainingAnalysis() {
  const snapshot = useGameSnapshot();
  const { theme } = useViewState();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisError, setAnalysisError] = useState<{ positionId: string; message: string } | null>(null);
  const [loadingFor, setLoadingFor] = useState<string | null>(null);
  const { compute } = useAiWorker();
  const generationRef = useRef(0);
  const positionId = `${snapshot.moves.length}:${snapshot.round}:${snapshot.stonesPlacedThisTurn}:${snapshot.currentPlayer}`;
  const positionIdRef = useRef(positionId);
  positionIdRef.current = positionId;
  const visibleAnalysis = analysis?.positionId === positionId ? analysis : null;
  const visibleError = analysisError?.positionId === positionId ? analysisError.message : "";
  const loading = loadingFor === positionId;

  const isDark = theme === "dark";
  const bgPanel = isDark ? "bg-black/70" : "bg-white/80";
  const borderColor = isDark ? "border-cyber-grid" : "border-gray-300";
  const textColor = isDark ? "text-cyan-300" : "text-blue-700";
  const textDim = isDark ? "text-gray-400" : "text-gray-500";

  const analyze = useCallback(async () => {
    if (loading) return;
    const generation = ++generationRef.current;
    setLoadingFor(positionId);
    setAnalysis(null);
    setAnalysisError(null);

    const board = Array.from(snapshot.board);
    const { config, currentPlayer } = snapshot;
    const aiStone = currentPlayer as unknown as Stone;
    const oppStone = aiStone === Stone.BLACK ? Stone.WHITE : Stone.BLACK;

    try {
      const req: AiRequestPayload = {
        board,
        config,
        aiColor: currentPlayer,
        currentPlayer,
        stonesToPlace: snapshot.round === 0 ? 1 : 2 - snapshot.stonesPlacedThisTurn,
      };
      const localResult = await compute(req);
      if (generationRef.current !== generation || positionIdRef.current !== positionId) return;

      const threats = analyzeThreats(board, config, aiStone);
      let bestMove: { x: number; y: number; z: number } | null = null;
      let bestMoveReason = "无可用着法";

      if (localResult.moves.length > 0) {
        bestMove = localResult.moves[0];
        bestMoveReason = explainMove(board, config, bestMove.x, bestMove.y, bestMove.z, aiStone, oppStone);
      }

      setAnalysis({ positionId, bestMove, bestMoveReason, threats });
    } catch (error) {
      if (generationRef.current === generation && positionIdRef.current === positionId) {
        setAnalysisError({
          positionId,
          message: error instanceof Error ? error.message : "分析暂时不可用",
        });
      }
    } finally {
      if (generationRef.current === generation) setLoadingFor(null);
    }
  }, [compute, loading, positionId, snapshot]);

  if (snapshot.winner !== Stone.EMPTY) return null;

  return (
    <div className="pointer-events-auto">
      <div className={`${bgPanel} backdrop-blur-sm border ${borderColor} rounded-lg p-3 w-64`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`${textColor} text-xs font-mono font-bold`}>训练分析</span>
          <button
            onClick={analyze}
            disabled={loading}
            className={`px-2 py-0.5 text-[10px] font-mono rounded ${isDark ? "bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30" : "bg-blue-500/15 text-blue-700 hover:bg-blue-500/25"} transition-colors disabled:opacity-50`}
          >
            {loading ? "分析中..." : "分析"}
          </button>
        </div>

        {visibleAnalysis ? (
          <div className="space-y-2 text-[11px] font-mono">
            {/* Threats */}
            {visibleAnalysis.threats.map((t, i) => (
              <p key={`${t}-${i}`} className={i === 0 && t.startsWith("紧急") ? "text-red-400 font-bold" : textDim}>{t}</p>
            ))}

            {/* Best move with reason */}
            <div className={`mt-2 p-2 rounded ${isDark ? "bg-white/5" : "bg-black/5"}`}>
              <p className={`${textColor} font-bold`}>
                推荐下在: {visibleAnalysis.bestMove
                  ? `(${visibleAnalysis.bestMove.x}, ${visibleAnalysis.bestMove.y}, ${visibleAnalysis.bestMove.z})`
                  : "无"}
              </p>
              <p className={`${textDim} mt-1`}>{visibleAnalysis.bestMoveReason}</p>
            </div>

            <p className={`text-[9px] ${textDim}`}>本地战术引擎 · 无网络请求</p>
          </div>
        ) : visibleError ? (
          <p className="text-[11px] font-mono text-red-400" role="alert">{visibleError}</p>
        ) : (
          <p className={`text-[11px] font-mono ${textDim}`}>
            点击"分析"获取 AI 局势评估
          </p>
        )}
      </div>
    </div>
  );
}
