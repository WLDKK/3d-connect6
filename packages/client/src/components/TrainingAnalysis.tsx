import { useState, useCallback } from "react";
import { computeAiMove, Player, Stone, type AiRequestPayload } from "@connect6/shared";
import { useGameSnapshot, useGameActions } from "../hooks/useGameStore";
import { useViewState } from "../hooks/useViewStore";

interface Analysis {
  bestMove: string;
  score: string;
  threat: string;
}

/**
 * Training mode AI analysis panel.
 * Player clicks "分析" to get AI evaluation of the current position.
 */
export function TrainingAnalysis() {
  const snapshot = useGameSnapshot();
  const { theme } = useViewState();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);

  const isDark = theme === "dark";
  const bgPanel = isDark ? "bg-black/70" : "bg-white/80";
  const borderColor = isDark ? "border-cyber-grid" : "border-gray-300";
  const textColor = isDark ? "text-cyber-accent" : "text-gray-800";
  const textDim = isDark ? "text-cyber-accent/60" : "text-gray-500";

  const analyze = useCallback(() => {
    setLoading(true);
    setAnalysis(null);

    // Run analysis in next tick to avoid blocking UI
    setTimeout(() => {
      const board = Array.from(snapshot.board);
      const { config, currentPlayer } = snapshot;

      // Evaluate best move for current player
      const req: AiRequestPayload = {
        board,
        config,
        aiColor: currentPlayer,
        currentPlayer,
        stonesToPlace: snapshot.round === 0 ? 1 : 2 - snapshot.stonesPlacedThisTurn,
        model: "local",
      };

      const result = computeAiMove(req);
      const bestMove = result.moves.length > 0
        ? result.moves.map(m => `(${m.x},${m.y},${m.z})`).join(" ")
        : "无";

      // Evaluate threats
      const oppColor = currentPlayer === Player.BLACK ? Player.WHITE : Player.BLACK;
      const oppReq: AiRequestPayload = { ...req, aiColor: oppColor };
      const oppResult = computeAiMove(oppReq);

      // Count stones
      let blackCount = 0, whiteCount = 0;
      for (const s of board) {
        if (s === Stone.BLACK) blackCount++;
        if (s === Stone.WHITE) whiteCount++;
      }

      // Simple score: difference in stone count + center control
      const advantage = currentPlayer === Player.BLACK
        ? `${blackCount} 黑 vs ${whiteCount} 白 — 黑方回合`
        : `${blackCount} 黑 vs ${whiteCount} 白 — 白方回合`;

      const threatInfo = oppResult.moves.length > 0
        ? `对手最佳应对: ${oppResult.moves.map(m => `(${m.x},${m.y},${m.z})`).join(" ")}`
        : "无明显威胁";

      setAnalysis({
        bestMove: `推荐落子: ${bestMove}`,
        score: advantage,
        threat: threatInfo,
      });
      setLoading(false);
    }, 50);
  }, [snapshot]);

  if (snapshot.winner !== Stone.EMPTY) return null;

  return (
    <div className="pointer-events-auto">
      <div className={`${bgPanel} backdrop-blur-sm border ${borderColor} rounded-lg p-3 w-52`}>
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
          <div className={`space-y-1 text-[10px] font-mono ${textDim}`}>
            <p className={textColor}>{analysis.bestMove}</p>
            <p>{analysis.score}</p>
            <p>{analysis.threat}</p>
          </div>
        ) : (
          <p className={`text-[10px] font-mono ${textDim}`}>点击"分析"获取 AI 建议</p>
        )}
      </div>
    </div>
  );
}
