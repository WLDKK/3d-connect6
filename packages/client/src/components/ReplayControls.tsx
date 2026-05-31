import { useReplayState, useReplayActions } from "../hooks/useReplayStore";
import { useViewState } from "../hooks/useViewStore";

/**
 * Replay controls — left/right arrows to step through game history.
 * Shown in the bottom-left corner.
 */
export function ReplayControls() {
  const { viewIndex, totalMoves, isLive } = useReplayState();
  const { goBack, goForward, goLatest } = useReplayActions();
  const { theme } = useViewState();

  const isDark = theme === "dark";
  const bg = isDark ? "bg-black/70" : "bg-white/80";
  const border = isDark ? "border-cyber-grid" : "border-gray-300";
  const text = isDark ? "text-cyber-accent" : "text-gray-800";
  const textDim = isDark ? "text-cyber-accent/50" : "text-gray-500";
  const btnBg = isDark ? "hover:bg-cyber-grid/50" : "hover:bg-gray-200";

  if (totalMoves === 0) return null;

  return (
    <div className="absolute bottom-4 left-4 pointer-events-auto">
      <div className={`${bg} backdrop-blur-sm border ${border} rounded-lg px-3 py-2 flex items-center gap-2 font-mono text-xs`}>
        <button
          onClick={goBack}
          disabled={viewIndex <= 0}
          className={`px-2 py-1 rounded ${btnBg} ${text} disabled:opacity-30 transition-colors`}
          title="上一步"
        >
          ◀
        </button>

        <span className={`${textDim} min-w-[60px] text-center`}>
          {isLive ? "实时" : `${viewIndex} / ${totalMoves}`}
        </span>

        <button
          onClick={goForward}
          disabled={viewIndex >= totalMoves}
          className={`px-2 py-1 rounded ${btnBg} ${text} disabled:opacity-30 transition-colors`}
          title="下一步"
        >
          ▶
        </button>

        {!isLive && (
          <button
            onClick={goLatest}
            className={`px-2 py-1 rounded ${btnBg} ${text} transition-colors ml-1`}
            title="回到最新"
          >
            ⏭
          </button>
        )}
      </div>
    </div>
  );
}
