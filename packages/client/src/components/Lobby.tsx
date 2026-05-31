import { useState, useCallback } from "react";
import { useWebSocketState } from "../hooks/useWebSocket";
import { useViewState, useViewActions } from "../hooks/useViewStore";
import { Player, Stone, type AiModelId, type ColorChoice } from "@connect6/shared";

/** Available AI models for the dropdown */
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

export function Lobby({ onEnterRoom, onLocalPlay, onTraining, onDualAi }: LobbyProps) {
  const [roomId, setRoomId] = useState("");
  const [aiModel, setAiModel] = useState<AiModelId>("local");
  const [colorChoice, setColorChoice] = useState<ColorChoice>("random");
  const [analyze, setAnalyze] = useState(false);
  const [dualModelBlack, setDualModelBlack] = useState<AiModelId>("local");
  const [dualModelWhite, setDualModelWhite] = useState<AiModelId>("local");
  const { status, error } = useWebSocketState();
  const { theme } = useViewState();
  const { toggleTheme } = useViewActions();

  const bgOuter = theme === "dark" ? "bg-cyber-bg" : "bg-[#f5f0e6]";
  const bgCard = theme === "dark" ? "bg-black/80" : "bg-white/90";
  const borderColor = theme === "dark" ? "border-cyber-grid" : "border-gray-300";
  const textPrimary = theme === "dark" ? "text-cyber-accent" : "text-gray-800";
  const textSecondary = theme === "dark" ? "text-cyber-accent/50" : "text-gray-500";

  const handleSubmit = useCallback(() => {
    const id = roomId.trim();
    if (!id) return;
    onEnterRoom(id);
  }, [roomId, onEnterRoom]);

  return (
    <div className={`absolute inset-0 flex items-center justify-center ${bgOuter} z-50 overflow-auto`}>
      <div className={`${bgCard} backdrop-blur-md border ${borderColor} rounded-xl p-8 w-[420px] my-4`}>
        <div className="flex justify-between items-start mb-2">
          <div />
          <h1 className={`text-3xl font-bold ${textPrimary} text-center tracking-wider`}>
            3D 六子棋
          </h1>
          <button
            onClick={toggleTheme}
            className={`${textSecondary} hover:opacity-80 text-xs font-mono mt-1`}
            title="切换主题"
          >
            {theme === "dark" ? "🌙" : "☀️"}
          </button>
        </div>
        <p className={`${textSecondary} text-xs text-center mb-5 font-mono`}>
          Connect6 · 3D 棋盘博弈
        </p>

        <div className="space-y-4">
          {/* ── 1. Single player ── */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className={`${textSecondary} text-[10px] font-mono block mb-1`}>AI 模型</label>
                <div className="relative">
                  <select
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value as AiModelId)}
                    className={`w-full ${theme === "dark" ? "bg-cyber-grid/50 text-white" : "bg-gray-100 text-gray-800"} px-2 py-1.5 pr-6 rounded outline-none border border-transparent focus:border-cyber-accent font-mono text-xs appearance-none cursor-pointer`}
                  >
                    {AI_MODELS.map(m => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <span className={`absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-[10px] ${textSecondary}`}>▼</span>
                </div>
              </div>
              <div className="flex-1">
                <label className={`${textSecondary} text-[10px] font-mono block mb-1`}>执棋颜色</label>
                <div className="relative">
                  <select
                    value={colorChoice}
                    onChange={(e) => setColorChoice(e.target.value as ColorChoice)}
                    className={`w-full ${theme === "dark" ? "bg-cyber-grid/50 text-white" : "bg-gray-100 text-gray-800"} px-2 py-1.5 pr-6 rounded outline-none border border-transparent focus:border-cyber-accent font-mono text-xs appearance-none cursor-pointer`}
                  >
                    {COLOR_OPTIONS.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <span className={`absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-[10px] ${textSecondary}`}>▼</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => onLocalPlay(aiModel, colorChoice)}
              className={`w-full py-2 ${theme === "dark" ? "bg-cyber-accent/20 text-cyber-accent hover:bg-cyber-accent/30" : "bg-blue-500/20 text-blue-700 hover:bg-blue-500/30"} rounded transition-colors font-mono text-sm`}
            >
              单机对弈
            </button>
          </div>

          {/* ── 2. Training ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className={`${textSecondary} text-[10px] font-mono`}>训练模式</span>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={analyze}
                  onChange={(e) => setAnalyze(e.target.checked)}
                  className="w-3 h-3 accent-cyan-400"
                />
                <span className={`${textSecondary} text-[10px] font-mono`}>AI 分析</span>
              </label>
            </div>
            {analyze && (
              <div>
                <label className={`${textSecondary} text-[10px] font-mono block mb-1`}>分析用 AI 模型</label>
                <div className="relative">
                  <select
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value as AiModelId)}
                    className={`w-full ${theme === "dark" ? "bg-cyber-grid/50 text-white" : "bg-gray-100 text-gray-800"} px-2 py-1.5 pr-6 rounded outline-none border border-transparent focus:border-cyber-accent font-mono text-xs appearance-none cursor-pointer`}
                  >
                    {AI_MODELS.map(m => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <span className={`absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-[10px] ${textSecondary}`}>▼</span>
                </div>
              </div>
            )}
            <button
              onClick={() => onTraining(analyze)}
              className={`w-full py-2 ${theme === "dark" ? "bg-purple-500/20 text-purple-300 hover:bg-purple-500/30" : "bg-purple-500/15 text-purple-700 hover:bg-purple-500/25"} rounded transition-colors font-mono text-sm`}
            >
              🧪 训练模式（自由落子）
            </button>
          </div>

          {/* ── 3. Dual AI ── */}
          <div className="space-y-2">
            <span className={`${textSecondary} text-[10px] font-mono`}>AI 对抗</span>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className={`${textSecondary} text-[10px] font-mono block mb-1`}>黑方 AI</label>
                <div className="relative">
                  <select
                    value={dualModelBlack}
                    onChange={(e) => setDualModelBlack(e.target.value as AiModelId)}
                    className={`w-full ${theme === "dark" ? "bg-cyber-grid/50 text-white" : "bg-gray-100 text-gray-800"} px-2 py-1.5 pr-6 rounded outline-none border border-transparent focus:border-cyber-accent font-mono text-xs appearance-none cursor-pointer`}
                  >
                    {AI_MODELS.map(m => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <span className={`absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-[10px] ${textSecondary}`}>▼</span>
                </div>
              </div>
              <div className="flex-1">
                <label className={`${textSecondary} text-[10px] font-mono block mb-1`}>白方 AI</label>
                <div className="relative">
                  <select
                    value={dualModelWhite}
                    onChange={(e) => setDualModelWhite(e.target.value as AiModelId)}
                    className={`w-full ${theme === "dark" ? "bg-cyber-grid/50 text-white" : "bg-gray-100 text-gray-800"} px-2 py-1.5 pr-6 rounded outline-none border border-transparent focus:border-cyber-accent font-mono text-xs appearance-none cursor-pointer`}
                  >
                    {AI_MODELS.map(m => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <span className={`absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-[10px] ${textSecondary}`}>▼</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => onDualAi(dualModelBlack, dualModelWhite)}
              className={`w-full py-2 ${theme === "dark" ? "bg-orange-500/20 text-orange-300 hover:bg-orange-500/30" : "bg-orange-500/15 text-orange-700 hover:bg-orange-500/25"} rounded transition-colors font-mono text-sm`}
            >
              🤖 AI 对抗（观赏模式）
            </button>
          </div>

          {/* ── 4. Multiplayer ── */}
          <div>
            <label className={`${textSecondary} text-xs font-mono block mb-1`}>
              房间名称
            </label>
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="输入房间名，如 room-1"
              className={`w-full ${theme === "dark" ? "bg-cyber-grid/50 text-white" : "bg-gray-100 text-gray-800"} px-4 py-2 rounded outline-none border border-transparent focus:border-cyber-accent font-mono text-sm`}
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={!roomId.trim() || status === "connecting"}
            className={`w-full py-2 ${theme === "dark" ? "bg-cyber-accent/10 text-cyber-accent/70 hover:bg-cyber-accent/20" : "bg-blue-500/10 text-blue-600 hover:bg-blue-500/20"} rounded transition-colors font-mono text-sm disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {status === "connecting" ? "连接中..." : "加入房间"}
          </button>

          {error && (
            <p className="text-red-400 text-xs font-mono text-center">
              {error === "Connection error"
                ? "无法连接服务器"
                : error}
            </p>
          )}
        </div>

        <div className={`${textSecondary} text-[10px] text-center mt-5 font-mono`}>
          <a href="https://github.com/WLDKK/3d-connect6/blob/main/RULES.md" target="_blank" rel="noopener" className={`${textSecondary} hover:opacity-80 underline`}>📖 游戏规则</a>
          {" · "}
          <a href="https://github.com/WLDKK/3d-connect6" target="_blank" rel="noopener" className={`${textSecondary} hover:opacity-80 underline`}>GitHub</a>
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
  const [remaining, setRemaining] = useState(90);

  const colorName = playerColor === Player.BLACK ? "黑方" : playerColor === Player.WHITE ? "白方" : "观战";
  const colorClass = playerColor === Player.BLACK ? "text-gray-300" : "text-white";
  const isConnected = status === "connected";
  const playerCount = roomInfo
    ? (roomInfo.players.black ? 1 : 0) + (roomInfo.players.white ? 1 : 0)
    : 0;
  const isGameOver = roomInfo?.state?.winner !== Stone.EMPTY;
  const isMyTurn = timer?.currentPlayer === playerColor;

  // Countdown tick
  const { theme } = useViewState();
  const accent = theme === "dark" ? "text-cyber-accent" : "text-gray-800";
  const accentDim = theme === "dark" ? "text-cyber-accent/50" : "text-gray-500";

  // Simple countdown
  const timerColor = remaining <= 15 ? "text-red-400" : remaining <= 30 ? "text-yellow-400" : accentDim;

  return (
    <div className="absolute bottom-4 right-4 font-mono text-xs pointer-events-none select-none">
      <div className="bg-black/70 backdrop-blur-sm border border-cyber-grid rounded-lg px-4 py-2">
        <div className={`${accentDim} text-[10px] mb-1`}>
          房间: {roomId}
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-400" : "bg-red-400"}`} />
          <span className={colorClass}>{colorName}</span>
          <span className={accentDim}>· {playerCount}/2</span>
        </div>
        {timer && !isGameOver && (
          <div className={`text-[11px] mt-1 font-bold ${timerColor}`}>
            ⏳ {remaining}s{isMyTurn && " — 你的回合"}
          </div>
        )}
        {error && <div className="text-red-400 text-[10px] mt-1">{error}</div>}
      </div>
    </div>
  );
}
