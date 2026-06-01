import { useState, useCallback, useEffect } from "react";
import { useWebSocketState } from "../hooks/useWebSocket";
import { useViewState, useViewActions } from "../hooks/useViewStore";
import { Player, Stone, type AiModelId, type ColorChoice } from "@connect6/shared";

const AI_MODELS: { id: AiModelId; label: string }[] = [
  { id: "local", label: "本地 AI（离线）" },
  { id: "qwen3.6-plus", label: "Qwen 3.6 Plus" },
  { id: "qwen3.7-max", label: "Qwen 3.7 Max" },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "glm-5.1", label: "GLM 5.1" },
];

const COLOR_OPTIONS: { value: ColorChoice; label: string }[] = [
  { value: "black", label: "执黑（先手）" },
  { value: "white", label: "执白（后手）" },
  { value: "random", label: "随机" },
];

interface LobbyProps {
  onEnterRoom: (roomId: string) => void;
  onLocalPlay: (model: AiModelId, color: ColorChoice) => void;
  onTraining: (analyze: boolean) => void;
  onDualAi: (modelBlack: AiModelId, modelWhite: AiModelId) => void;
}

function SelectField({ label, value, onChange, options, theme }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { id?: string; value?: string; label: string }[];
  theme: "dark" | "light";
}) {
  const isDark = theme === "dark";
  return (
    <div>
      <label className={`text-[10px] font-mono block mb-1 ${isDark ? "text-white/40" : "text-gray-500"}`}>{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full ${isDark ? "bg-white/5 text-white border-white/10 hover:border-white/20" : "bg-gray-50 text-gray-800 border-gray-200 hover:border-gray-300"} px-3 py-2 pr-7 rounded-lg outline-none border font-mono text-xs appearance-none cursor-pointer transition-colors focus:border-cyan-400/50`}
        >
          {options.map((o) => (
            <option key={o.id || o.value} value={o.id || o.value}>{o.label}</option>
          ))}
        </select>
        <span className={`absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[9px] ${isDark ? "text-white/30" : "text-gray-400"}`}>▾</span>
      </div>
    </div>
  );
}

export function Lobby({ onEnterRoom, onLocalPlay, onTraining, onDualAi }: LobbyProps) {
  const [roomId, setRoomId] = useState("");
  const [aiModel, setAiModel] = useState<AiModelId>("deepseek-v4-flash");
  const [colorChoice, setColorChoice] = useState<ColorChoice>("random");
  const [analyze, setAnalyze] = useState(true);
  const [dualModelBlack, setDualModelBlack] = useState<AiModelId>("glm-5.1");
  const [dualModelWhite, setDualModelWhite] = useState<AiModelId>("glm-5.1");
  const { status, error } = useWebSocketState();
  const { theme } = useViewState();
  const { toggleTheme } = useViewActions();

  const isDark = theme === "dark";
  const handleSubmit = useCallback(() => {
    const id = roomId.trim();
    if (!id) return;
    onEnterRoom(id);
  }, [roomId, onEnterRoom]);

  return (
    <div className={`absolute inset-0 z-50 overflow-auto ${isDark ? "bg-[#06080f]" : "bg-[#f0ebe3]"}`}>
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {isDark ? (
          <>
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(0,240,255,0.06),transparent_60%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_20%,rgba(123,97,255,0.06),transparent_60%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_80%,rgba(0,240,255,0.03),transparent_50%)]" />
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/20 to-transparent" />
            {/* Grid pattern */}
            <div className="absolute inset-0 opacity-[0.03]" style={{
              backgroundImage: "linear-gradient(rgba(0,240,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(0,240,255,0.3) 1px, transparent 1px)",
              backgroundSize: "60px 60px"
            }} />
            {/* Floating particles */}
            <div className="absolute w-1 h-1 bg-cyan-400/30 rounded-full animate-pulse" style={{ top: "20%", left: "15%" }} />
            <div className="absolute w-1.5 h-1.5 bg-purple-400/20 rounded-full animate-pulse" style={{ top: "60%", left: "80%", animationDelay: "1s" }} />
            <div className="absolute w-1 h-1 bg-cyan-400/20 rounded-full animate-pulse" style={{ top: "80%", left: "30%", animationDelay: "2s" }} />
          </>
        ) : (
          <>
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(59,130,246,0.06),transparent_60%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_20%,rgba(168,85,247,0.05),transparent_60%)]" />
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-300/30 to-transparent" />
            <div className="absolute inset-0 opacity-[0.03]" style={{
              backgroundImage: "linear-gradient(rgba(0,0,0,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.15) 1px, transparent 1px)",
              backgroundSize: "60px 60px"
            }} />
          </>
        )}
      </div>

      {/* Content */}
      <div className="relative flex items-center justify-center min-h-full p-4">
        <div className="w-full max-w-[440px]">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-2">
              <div className={`w-8 h-8 rounded-lg ${isDark ? "bg-cyan-500/10 border-cyan-500/20" : "bg-blue-500/10 border-blue-500/20"} border flex items-center justify-center`}>
                <span className="text-sm">♟</span>
              </div>
              <h1 className={`text-3xl font-bold tracking-wider ${isDark ? "text-white" : "text-gray-900"}`}>
                3D 六子棋
              </h1>
              <button
                onClick={toggleTheme}
                className={`w-8 h-8 rounded-lg ${isDark ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-gray-100 border-gray-200 hover:bg-gray-200"} border flex items-center justify-center transition-colors text-sm`}
                title="切换主题"
              >
                {isDark ? "☀" : "🌙"}
              </button>
            </div>
            <p className={`text-xs font-mono tracking-widest uppercase ${isDark ? "text-white/25" : "text-gray-400"}`}>
              Connect6 · 3D Strategy Game
            </p>
          </div>

          {/* Mode Cards */}
          <div className="space-y-3">
            {/* Card 1: Single Player */}
            <div className={`${isDark ? "bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]" : "bg-white/60 border-gray-200/60 hover:border-gray-300"} border rounded-xl p-4 transition-colors group`}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-sm ${isDark ? "text-cyan-400" : "text-blue-600"}`}>⚔</span>
                <span className={`text-xs font-bold tracking-wide ${isDark ? "text-white/80" : "text-gray-700"}`}>单机对弈</span>
                <span className={`text-[10px] font-mono ml-auto ${isDark ? "text-white/20" : "text-gray-400"}`}>人 vs AI</span>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <SelectField label="AI 模型" value={aiModel} onChange={(v) => setAiModel(v as AiModelId)} options={AI_MODELS} theme={theme} />
                <SelectField label="执棋" value={colorChoice} onChange={(v) => setColorChoice(v as ColorChoice)} options={COLOR_OPTIONS} theme={theme} />
              </div>
              <button
                onClick={() => onLocalPlay(aiModel, colorChoice)}
                className={`w-full py-2.5 rounded-lg font-mono text-xs tracking-wide transition-all ${isDark ? "bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20 hover:border-cyan-500/30" : "bg-blue-500/10 text-blue-600 hover:bg-blue-500/15 border border-blue-500/20 hover:border-blue-500/30"}`}
              >
                开始对弈
              </button>
            </div>

            {/* Card 2: Training */}
            <div className={`${isDark ? "bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]" : "bg-white/60 border-gray-200/60 hover:border-gray-300"} border rounded-xl p-4 transition-colors`}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-sm ${isDark ? "text-purple-400" : "text-purple-600"}`}>🧪</span>
                <span className={`text-xs font-bold tracking-wide ${isDark ? "text-white/80" : "text-gray-700"}`}>训练模式</span>
                <span className={`text-[10px] font-mono ml-auto ${isDark ? "text-white/20" : "text-gray-400"}`}>自由落子</span>
              </div>
              <div className="flex items-center gap-3 mb-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={analyze} onChange={(e) => setAnalyze(e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-purple-400" />
                  <span className={`text-[11px] font-mono ${isDark ? "text-white/50" : "text-gray-500"}`}>AI 分析</span>
                </label>
                {analyze && (
                  <div className="flex-1">
                    <SelectField label="" value={aiModel} onChange={(v) => setAiModel(v as AiModelId)} options={AI_MODELS} theme={theme} />
                  </div>
                )}
              </div>
              <button
                onClick={() => onTraining(analyze)}
                className={`w-full py-2.5 rounded-lg font-mono text-xs tracking-wide transition-all ${isDark ? "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20 hover:border-purple-500/30" : "bg-purple-500/10 text-purple-600 hover:bg-purple-500/15 border border-purple-500/20 hover:border-purple-500/30"}`}
              >
                进入训练
              </button>
            </div>

            {/* Card 3: AI vs AI */}
            <div className={`${isDark ? "bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]" : "bg-white/60 border-gray-200/60 hover:border-gray-300"} border rounded-xl p-4 transition-colors`}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-sm ${isDark ? "text-orange-400" : "text-orange-600"}`}>🤖</span>
                <span className={`text-xs font-bold tracking-wide ${isDark ? "text-white/80" : "text-gray-700"}`}>AI 对抗</span>
                <span className={`text-[10px] font-mono ml-auto ${isDark ? "text-white/20" : "text-gray-400"}`}>观赏模式</span>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <SelectField label="⚫ 黑方" value={dualModelBlack} onChange={(v) => setDualModelBlack(v as AiModelId)} options={AI_MODELS} theme={theme} />
                <SelectField label="⚪ 白方" value={dualModelWhite} onChange={(v) => setDualModelWhite(v as AiModelId)} options={AI_MODELS} theme={theme} />
              </div>
              <button
                onClick={() => onDualAi(dualModelBlack, dualModelWhite)}
                className={`w-full py-2.5 rounded-lg font-mono text-xs tracking-wide transition-all ${isDark ? "bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border border-orange-500/20 hover:border-orange-500/30" : "bg-orange-500/10 text-orange-600 hover:bg-orange-500/15 border border-orange-500/20 hover:border-orange-500/30"}`}
              >
                开始观赏
              </button>
            </div>

            {/* Card 4: Multiplayer */}
            <div className={`${isDark ? "bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]" : "bg-white/60 border-gray-200/60 hover:border-gray-300"} border rounded-xl p-4 transition-colors`}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-sm ${isDark ? "text-green-400" : "text-green-600"}`}>👥</span>
                <span className={`text-xs font-bold tracking-wide ${isDark ? "text-white/80" : "text-gray-700"}`}>多人对战</span>
                <span className={`text-[10px] font-mono ml-auto ${isDark ? "text-white/20" : "text-gray-400"}`}>实时匹配</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  placeholder="输入房间名..."
                  className={`flex-1 ${isDark ? "bg-white/5 text-white border-white/10 placeholder-white/20 focus:border-cyan-500/40" : "bg-gray-50 text-gray-800 border-gray-200 placeholder-gray-400 focus:border-blue-400/60"} px-3 py-2.5 rounded-lg outline-none border font-mono text-xs transition-colors`}
                />
                <button
                  onClick={handleSubmit}
                  disabled={!roomId.trim() || status === "connecting"}
                  className={`px-5 py-2.5 rounded-lg font-mono text-xs tracking-wide transition-all disabled:opacity-30 ${isDark ? "bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/20 hover:border-green-500/30" : "bg-green-500/10 text-green-600 hover:bg-green-500/15 border border-green-500/20 hover:border-green-500/30"}`}
                >
                  {status === "connecting" ? "连接中" : "加入"}
                </button>
              </div>
              {error && (
                <p className="text-red-400 text-[10px] font-mono mt-2 text-center">
                  {error === "Connection error" ? "无法连接服务器" : error}
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className={`text-center mt-6 text-[10px] font-mono space-x-3 ${isDark ? "text-white/15" : "text-gray-400"}`}>
            <a href="https://github.com/WLDKK/3d-connect6/blob/main/RULES.md" target="_blank" rel="noopener"
              className={`${isDark ? "hover:text-white/30" : "hover:text-gray-600"} transition-colors`}>📖 规则</a>
            <span>·</span>
            <a href="https://github.com/WLDKK/3d-connect6" target="_blank" rel="noopener"
              className={`${isDark ? "hover:text-white/30" : "hover:text-gray-600"} transition-colors`}>GitHub</a>
          </div>
        </div>
      </div>
    </div>
  );
}

interface RoomStatusProps {
  roomId: string;
}

export function RoomStatus({ roomId }: RoomStatusProps) {
  const { status, playerColor, roomInfo, timer, error } = useWebSocketState();
  const [remaining, setRemaining] = useState(0);
  const { theme } = useViewState();

  const isDark = theme === "dark";
  const colorName = playerColor === Player.BLACK ? "黑方" : playerColor === Player.WHITE ? "白方" : "观战";
  const colorClass = playerColor === Player.BLACK ? "text-gray-300" : "text-white";
  const isConnected = status === "connected";
  const playerCount = roomInfo
    ? (roomInfo.players.black ? 1 : 0) + (roomInfo.players.white ? 1 : 0)
    : 0;
  const isGameOver = roomInfo?.state?.winner !== Stone.EMPTY;
  const isMyTurn = timer?.currentPlayer === playerColor;

  useEffect(() => {
    if (!timer || isGameOver) { setRemaining(0); return; }
    const update = () => {
      const elapsed = Date.now() - timer.turnStartTime;
      setRemaining(Math.max(0, Math.ceil((timer.remainingMs - elapsed) / 1000)));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [timer, isGameOver]);

  const timerColor = remaining <= 15 ? "text-red-400" : remaining <= 30 ? "text-yellow-400" : isDark ? "text-white/40" : "text-gray-500";

  return (
    <div className="absolute bottom-16 right-4 font-mono text-xs pointer-events-none select-none">
      <div className={`${isDark ? "bg-black/60 border-white/10" : "bg-white/70 border-gray-200"} backdrop-blur-sm border rounded-lg px-4 py-2`}>
        <div className={`${isDark ? "text-white/30" : "text-gray-500"} text-[10px] mb-1`}>
          房间: {roomId}
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-green-400" : "bg-red-400"}`} />
          <span className={colorClass}>{colorName}</span>
          <span className={isDark ? "text-white/30" : "text-gray-400"}>· {playerCount}/2</span>
        </div>
        {timer && !isGameOver && remaining > 0 && (
          <div className={`text-[11px] mt-1 font-bold ${timerColor}`}>
            ⏳ {remaining}s{isMyTurn && " — 你的回合"}
          </div>
        )}
        {error && <div className="text-red-400 text-[10px] mt-1">{error}</div>}
      </div>
    </div>
  );
}
