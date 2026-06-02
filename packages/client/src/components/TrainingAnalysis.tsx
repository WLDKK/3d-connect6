import { useState, useCallback, useRef } from "react";
import {
  computeAiMove, scoreCell,
  Player, Stone,
  type AiRequestPayload, type BoardConfig,
} from "@connect6/shared";
import { useGameSnapshot } from "../hooks/useGameStore";
import { useViewState } from "../hooks/useViewStore";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface Analysis {
  /** Best move coordinates */
  bestMove: string;
  /** Threat level description */
  threats: string[];
  /** Strategic recommendation */
  advice: string;
  /** Source: "llm" or "local" */
  source: string;
  /** LLM raw text (if available) */
  llmText?: string;
}

/** Score thresholds matching ai.ts lineScore table */
const SCORE = {
  WIN: 500000,
  OPEN5: 50000,
  OPEN4: 1200,
  OPEN3: 100,
  OPEN2: 20,
};

function analyzePositionLocal(board: number[], config: BoardConfig, aiStone: Stone): {
  myWins: string[]; oppWins: string[];
  myOpen5: string[]; oppOpen5: string[];
  myOpen4: number; oppOpen4: number;
  myOpen3: number; oppOpen3: number;
} {
  const { sizeX: sx, sizeY: sy, sizeZ: sz } = config;
  const oppStone = aiStone === Stone.BLACK ? Stone.WHITE : Stone.BLACK;
  const result = {
    myWins: [] as string[], oppWins: [] as string[],
    myOpen5: [] as string[], oppOpen5: [] as string[],
    myOpen4: 0, oppOpen4: 0,
    myOpen3: 0, oppOpen3: 0,
  };

  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        if (board[z * sy * sx + y * sx + x] !== Stone.EMPTY) continue;
        const myScore = scoreCell(board, config, x, y, z, aiStone);
        const oppScore = scoreCell(board, config, x, y, z, oppStone);

        if (myScore >= SCORE.WIN) result.myWins.push(`(${x},${y},${z})`);
        if (oppScore >= SCORE.WIN) result.oppWins.push(`(${x},${y},${z})`);
        if (myScore >= SCORE.OPEN5 && myScore < SCORE.WIN) result.myOpen5.push(`(${x},${y},${z})`);
        if (oppScore >= SCORE.OPEN5 && oppScore < SCORE.WIN) result.oppOpen5.push(`(${x},${y},${z})`);
        if (myScore >= SCORE.OPEN4 && myScore < SCORE.OPEN5) result.myOpen4++;
        if (oppScore >= SCORE.OPEN4 && oppScore < SCORE.OPEN5) result.oppOpen4++;
        if (myScore >= SCORE.OPEN3 && myScore < SCORE.OPEN4) result.myOpen3++;
        if (oppScore >= SCORE.OPEN3 && oppScore < SCORE.OPEN4) result.oppOpen3++;
      }
    }
  }
  return result;
}

/**
 * Call LLM server for strategic analysis text.
 * Returns the LLM's analysis or null on failure.
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
  const abortRef = useRef<AbortController | null>(null);

  const isDark = theme === "dark";
  const bgPanel = isDark ? "bg-black/70" : "bg-white/80";
  const borderColor = isDark ? "border-cyber-grid" : "border-gray-300";
  const textColor = isDark ? "text-cyber-accent" : "text-gray-800";
  const textDim = isDark ? "text-cyber-accent/60" : "text-gray-500";

  const analyze = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setAnalysis(null);

    const board = Array.from(snapshot.board);
    const { config, currentPlayer } = snapshot;
    const aiStone = currentPlayer as unknown as Stone;

    // Step 1: Local threat analysis (instant)
    const threats = analyzePositionLocal(board, config, aiStone);
    const threatLines: string[] = [];

    if (threats.oppWins.length > 0)
      threatLines.push(`🚨 对手可获胜: ${threats.oppWins.join(", ")}`);
    if (threats.myWins.length > 0)
      threatLines.push(`✅ 你可以获胜: ${threats.myWins.join(", ")}`);
    if (threats.oppOpen5.length > 0)
      threatLines.push(`⚠️ 对手 Open-5: ${threats.oppOpen5.slice(0, 3).join(", ")}`);
    if (threats.myOpen5.length > 0)
      threatLines.push(`🎯 我方 Open-5: ${threats.myOpen5.slice(0, 3).join(", ")}`);
    if (threats.myOpen4 >= 2)
      threatLines.push(`💪 我方 ${threats.myOpen4} 条 Open-4 — 双威胁机会`);
    if (threats.oppOpen4 >= 2)
      threatLines.push(`🛡️ 对手 ${threats.oppOpen4} 条 Open-4 — 注意防守`);
    if (threatLines.length === 0)
      threatLines.push("📋 无紧急威胁，构建开放线");

    // Step 2: Local AI best move (instant)
    const req: AiRequestPayload = {
      board,
      config,
      aiColor: currentPlayer,
      currentPlayer,
      stonesToPlace: snapshot.round === 0 ? 1 : 2 - snapshot.stonesPlacedThisTurn,
      model: "local",
    };
    const localResult = computeAiMove(req);
    const localMove = localResult.moves.length > 0
      ? localResult.moves.map(m => `(${m.x},${m.y},${m.z})`).join(" ")
      : "无";

    // Set initial analysis immediately
    setAnalysis({
      bestMove: localMove,
      threats: threatLines,
      advice: "正在请求 LLM 深度分析...",
      source: "local",
    });
    setLoading(false);

    // Step 3: Try LLM analysis (async, may take 10-30s)
    const llmResult = await callLLMAnalysis(snapshot);
    if (llmResult) {
      setAnalysis(prev => prev ? {
        ...prev,
        advice: llmResult,
        source: "llm",
      } : prev);
    } else {
      setAnalysis(prev => prev ? {
        ...prev,
        advice: "LLM 不可用，以上为本地 AI 分析",
        source: "local",
      } : prev);
    }
  }, [snapshot, loading]);

  if (snapshot.winner !== Stone.EMPTY) return null;

  return (
    <div className="pointer-events-auto">
      <div className={`${bgPanel} backdrop-blur-sm border ${borderColor} rounded-lg p-3 w-60`}>
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
          <div className="space-y-1.5 text-[10px] font-mono">
            {/* Threats */}
            {analysis.threats.map((t, i) => (
              <p key={i} className={textDim}>{t}</p>
            ))}

            {/* Best move */}
            <p className={textColor}>
              推荐: <span className="text-yellow-400">{analysis.bestMove}</span>
            </p>

            {/* Source badge */}
            <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] ${
              analysis.source === "llm"
                ? "bg-green-500/20 text-green-400"
                : "bg-gray-500/20 text-gray-400"
            }`}>
              {analysis.source === "llm" ? "☁️ LLM 分析" : "💻 本地分析"}
            </span>

            {/* LLM advice */}
            {analysis.llmText && (
              <p className={`${textDim} mt-1 leading-relaxed`}>{analysis.llmText}</p>
            )}
          </div>
        ) : (
          <p className={`text-[10px] font-mono ${textDim}`}>
            点击"分析"获取 AI 局势评估
          </p>
        )}
      </div>
    </div>
  );
}
