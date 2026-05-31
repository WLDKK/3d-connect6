import { useState, useCallback, useEffect } from "react";
import { useWebSocketState } from "../hooks/useWebSocket";
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
}

export function Lobby({ onEnterRoom, onLocalPlay }: LobbyProps) {
  const [roomId, setRoomId] = useState("");
  const [aiModel, setAiModel] = useState<AiModelId>("qwen3.6-plus");
  const [colorChoice, setColorChoice] = useState<ColorChoice>("black");
  const { status, error } = useWebSocketState();

  const handleSubmit = useCallback(() => {
    const id = roomId.trim();
    if (!id) return;
    onEnterRoom(id);
  }, [roomId, onEnterRoom]);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-cyber-bg z-50">
      <div className="bg-black/80 backdrop-blur-md border border-cyber-grid rounded-xl p-8 w-96">
        <h1 className="text-3xl font-bold text-cyber-accent text-center mb-2 tracking-wider">
          3D 六子棋
        </h1>
        <p className="text-cyber-accent/50 text-xs text-center mb-6 font-mono">
          Connect6 · 3D 棋盘博弈
        </p>

        <div className="space-y-4">
          {/* ── Single player section ── */}
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-cyber-accent/70 text-[10px] font-mono block mb-1">AI 模型</label>
                <select
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value as AiModelId)}
                  className="w-full bg-cyber-grid/50 text-white px-2 py-1.5 rounded outline-none border border-transparent focus:border-cyber-accent font-mono text-xs appearance-none cursor-pointer"
                >
                  {AI_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="text-cyber-accent/70 text-[10px] font-mono block mb-1">执棋颜色</label>
                <select
                  value={colorChoice}
                  onChange={(e) => setColorChoice(e.target.value as ColorChoice)}
                  className="w-full bg-cyber-grid/50 text-white px-2 py-1.5 rounded outline-none border border-transparent focus:border-cyber-accent font-mono text-xs appearance-none cursor-pointer"
                >
                  {COLOR_OPTIONS.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={() => onLocalPlay(aiModel, colorChoice)}
              className="w-full py-2.5 bg-cyber-accent/20 text-cyber-accent rounded hover:bg-cyber-accent/30 transition-colors font-mono text-sm"
            >
              单机对弈
            </button>
          </div>

          {/* ── Divider ── */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-cyber-grid/50" />
            </div>
            <div className="relative flex justify-center text-[10px]">
              <span className="bg-black/80 px-2 text-cyber-accent/30 font-mono">或 多人对战</span>
            </div>
          </div>

          {/* ── Multiplayer section ── */}
          <div>
            <label className="text-cyber-accent/70 text-xs font-mono block mb-1">
              房间名称
            </label>
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="输入房间名，如 room-1"
              className="w-full bg-cyber-grid/50 text-white px-4 py-2 rounded outline-none border border-transparent focus:border-cyber-accent font-mono text-sm"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={!roomId.trim() || status === "connecting"}
            className="w-full py-2 bg-cyber-accent/10 text-cyber-accent/70 rounded hover:bg-cyber-accent/20 transition-colors font-mono text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === "connecting" ? "连接中..." : "加入房间"}
          </button>

          {error && (
            <p className="text-red-400 text-xs font-mono text-center">
              {error === "Connection error"
                ? "无法连接服务器 — 请确认已运行 npm run dev:server"
                : error}
            </p>
          )}
        </div>

        <div className="text-cyber-accent/30 text-[10px] text-center mt-6 font-mono leading-relaxed space-y-1">
          <p>
            <a href="https://github.com/WLDKK/3d-connect6/blob/main/RULES.md" target="_blank" rel="noopener" className="text-cyber-accent/50 hover:text-cyber-accent/70 underline">📖 游戏规则</a>
            {" · "}
            <a href="https://github.com/WLDKK/3d-connect6" target="_blank" rel="noopener" className="text-cyber-accent/50 hover:text-cyber-accent/70 underline">GitHub</a>
          </p>
          <p>多人对战需在另一个终端运行 <span className="text-cyber-accent/50">npm run dev:server</span></p>
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
  useEffect(() => {
    if (!timer || isGameOver) return;

    const update = () => {
      const elapsed = Date.now() - timer.turnStartTime;
      const left = Math.max(0, Math.ceil((timer.remainingMs - elapsed) / 1000));
      setRemaining(left);
    };

    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [timer, isGameOver]);

  return (
    <div className="absolute bottom-4 right-4 font-mono text-xs pointer-events-none select-none">
      <div className="bg-black/70 backdrop-blur-sm border border-cyber-grid rounded-lg px-4 py-2">
        <div className="text-cyber-accent/50 text-[10px] mb-1">
          房间: {roomId}
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-400" : "bg-red-400"}`} />
          <span className={colorClass}>{colorName}</span>
          <span className="text-cyber-accent/40">· {playerCount}/2</span>
        </div>
        {timer && !isGameOver && (
          <div className={`text-[11px] mt-1 font-bold ${remaining <= 15 ? "text-red-400" : remaining <= 30 ? "text-yellow-400" : "text-cyber-accent/60"}`}>
            {isMyTurn ? "⏳" : "⏳"} {remaining}s
            {isMyTurn && " — 你的回合"}
          </div>
        )}
        {error && <div className="text-red-400 text-[10px] mt-1">{error}</div>}
      </div>
    </div>
  );
}
