import { useViewState, useViewActions } from "../hooks/useViewStore";
import { useGameSnapshot } from "../hooks/useGameStore";

export function ControlPanel() {
  const { transparencyEnabled, sliceEnabled, sliceAxis, sliceIndex, theme } = useViewState();
  const { toggleTransparency, toggleSliceEnabled, setSliceAxis, setSliceIndex, toggleTheme } = useViewActions();
  const snapshot = useGameSnapshot();
  const { sizeX, sizeY, sizeZ } = snapshot.config;

  const maxIdx = sliceAxis === "x" ? sizeX - 1 : sliceAxis === "y" ? sizeY - 1 : sizeZ - 1;

  return (
    <div className="w-52 font-mono text-xs select-none">
      <div className="bg-black/60 backdrop-blur-sm border border-cyber-grid rounded-lg p-3 space-y-3">
        <h2 className="text-cyber-accent text-sm font-bold tracking-wider border-b border-cyber-grid pb-2">
          视图控制
        </h2>

        {/* Theme */}
        <button
          onClick={toggleTheme}
          className="w-full py-1.5 rounded text-center transition-all bg-cyber-grid/50 text-gray-400 border border-transparent hover:border-cyber-grid"
        >
          {theme === "dark" ? "☀️ 白天模式" : "🌙 黑夜模式"}
        </button>

        {/* Slice Monitor */}
        <div className="space-y-1">
          <button
            onClick={toggleSliceEnabled}
            className={`w-full py-1.5 rounded text-center transition-all ${
              sliceEnabled
                ? "bg-cyber-accent/20 text-cyber-accent border border-cyber-accent/40"
                : "bg-cyber-grid/50 text-gray-400 border border-transparent hover:border-cyber-grid"
            }`}
          >
            {sliceEnabled ? "切片监视：开" : "切片监视：关"}
          </button>

          {sliceEnabled && (
            <div className="space-y-1.5">
              <div className="flex gap-1">
                {(["x", "y", "z"] as const).map((axis) => (
                  <button
                    key={axis}
                    onClick={() => { setSliceAxis(axis); setSliceIndex(0); }}
                    className={`flex-1 py-1 rounded text-center transition-all ${
                      sliceAxis === axis
                        ? "bg-cyber-accent/20 text-cyber-accent"
                        : "bg-cyber-grid/30 text-gray-500"
                    }`}
                  >
                    {axis.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">层</span>
                <input
                  type="range"
                  min={0}
                  max={maxIdx}
                  value={sliceIndex}
                  onChange={(e) => setSliceIndex(Number(e.target.value))}
                  className="flex-1 accent-cyan-400 h-1"
                />
                <span className="text-cyber-accent w-5 text-right">{sliceIndex}</span>
              </div>
            </div>
          )}
        </div>

        {/* Transparency */}
        <button
          onClick={toggleTransparency}
          className={`w-full py-1.5 rounded text-center transition-all ${
            transparencyEnabled
              ? "bg-cyber-glow/20 text-purple-300 border border-purple-500/30"
              : "bg-cyber-grid/50 text-gray-400 border border-transparent hover:border-cyber-grid"
          }`}
        >
          {transparencyEnabled ? "透视：开" : "透视：关"}
        </button>

        <p className="text-gray-600 text-[10px] leading-tight pt-1 border-t border-cyber-grid/50">
          悬停棋盘查看被遮挡棋子。切片可逐层检查棋盘截面。
        </p>
      </div>
    </div>
  );
}
