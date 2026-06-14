import { useState, useCallback, useEffect, useRef } from "react";
import { useWebSocketState } from "../hooks/useWebSocket";
import { useViewState, useViewActions } from "../hooks/useViewStore";
import { Player, Stone, type AiModelId, type ColorChoice } from "@connect6/shared";

const AI_MODELS: { id: AiModelId; label: string }[] = [
  { id: "local", label: "贪心Pro（算法）" },
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
  onTraining: (analyze: boolean, model: AiModelId) => void;
  onDualAi: (modelBlack: AiModelId, modelWhite: AiModelId) => void;
}

/* ── Mystic Select ── */
function MysticSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { id?: string; value?: string; label: string }[];
}) {
  return (
    <div>
      <label className="text-[10px] font-mono block mb-1 text-slate-500">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-white/[0.04] text-slate-200 px-3 py-2 pr-7 rounded-lg outline-none border border-white/[0.06] hover:border-white/[0.12] font-mono text-xs appearance-none cursor-pointer transition-all duration-300 focus:border-amber-400/30 focus:shadow-[0_0_12px_rgba(217,160,60,0.06)]"
        >
          {options.map((o) => (
            <option key={o.id || o.value} value={o.id || o.value} className="bg-[#0a0e17]">{o.label}</option>
          ))}
        </select>
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[9px] text-white/20">▾</span>
      </div>
    </div>
  );
}

/* ── Mystic Card ── */
function MysticCard({ icon, title, subtitle, delay, children }: {
  icon: string; title: string; subtitle: string; delay: number; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      ref={ref}
      className="mystic-card"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translate3d(0,0,0)" : "translate3d(0,24px,0)",
        transition: `opacity 0.6s cubic-bezier(0.22,1,0.36,1), transform 0.6s cubic-bezier(0.22,1,0.36,1)`,
      }}
    >
      <div className="flex items-center gap-2.5 mb-3.5">
        <span className="text-sm opacity-70">{icon}</span>
        <span className="text-xs font-bold tracking-wide text-slate-100">{title}</span>
        <span className="text-[10px] font-mono ml-auto text-slate-600">{subtitle}</span>
      </div>
      {children}
    </div>
  );
}

/* ── Mystic Button ── */
function MysticBtn({ onClick, children, color = "cyan", disabled }: {
  onClick: () => void; children: React.ReactNode; color?: string; disabled?: boolean;
}) {
  const colorMap: Record<string, string> = {
    cyan: "from-amber-500/15 to-yellow-600/10 border-amber-400/15 hover:border-amber-400/30 hover:shadow-[0_0_20px_rgba(217,160,60,0.1)] text-amber-300",
    purple: "from-rose-400/15 to-pink-500/10 border-rose-400/15 hover:border-rose-400/30 hover:shadow-[0_0_20px_rgba(251,113,133,0.08)] text-rose-300",
    orange: "from-orange-400/15 to-amber-500/10 border-orange-400/15 hover:border-orange-400/30 hover:shadow-[0_0_20px_rgba(251,146,60,0.1)] text-orange-300",
    green: "from-teal-400/15 to-emerald-500/10 border-teal-400/15 hover:border-teal-400/30 hover:shadow-[0_0_20px_rgba(45,212,191,0.08)] text-teal-300",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full py-2.5 rounded-lg font-mono text-xs tracking-wide transition-all duration-300
        bg-gradient-to-r border disabled:opacity-30 disabled:cursor-not-allowed
        hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.98]
        ${colorMap[color] || colorMap.cyan}`}
    >
      {children}
    </button>
  );
}

/* ── Main Lobby ── */
export function Lobby({ onEnterRoom, onLocalPlay, onTraining, onDualAi }: LobbyProps) {
  const [roomId, setRoomId] = useState("");
  const [aiModel, setAiModel] = useState<AiModelId>("local");
  const [colorChoice, setColorChoice] = useState<ColorChoice>("random");
  const [analyze, setAnalyze] = useState(true);
  const [trainModel, setTrainModel] = useState<AiModelId>("local");
  const [dualModelBlack, setDualModelBlack] = useState<AiModelId>("glm-5.1");
  const [dualModelWhite, setDualModelWhite] = useState<AiModelId>("glm-5.1");
  const { status, error } = useWebSocketState();
  const { toggleTheme } = useViewActions();

  const handleSubmit = useCallback(() => {
    const id = roomId.trim();
    if (id) onEnterRoom(id);
  }, [roomId, onEnterRoom]);

  return (
    <div className="lobby-root">
      {/* ── Background glow ── */}
      <div className="lobby-fog-a" />

      {/* ── Content ── */}
      <div className="relative flex items-center justify-center min-h-full p-4">
        <div className="w-full max-w-[460px]">
          {/* Header */}
          <div className="text-center mb-10" style={{ animation: "fadeUp 0.8s cubic-bezier(0.22,1,0.36,1) both" }}>
            <button
              onClick={toggleTheme}
              className="absolute top-6 right-6 w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.15] flex items-center justify-center transition-all duration-300 text-sm text-slate-400 hover:text-slate-200"
              title="切换主题"
            >
              {useViewState().theme === "dark" ? "☀" : "🌙"}
            </button>
            <h1 className="text-4xl font-black tracking-tight mb-2 bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              3D 六子棋
            </h1>
            <p className="text-[11px] font-mono tracking-[0.3em] uppercase text-slate-600">
              Connect6 · 3D Strategy
            </p>
            <div className="mt-5 mx-auto w-24 h-px bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
          </div>

          {/* Mode cards */}
          <div className="space-y-3">
            {/* 1. Single Player */}
            <MysticCard icon="⚔" title="单机对弈" subtitle="人 vs AI" delay={120}>
              <div className="grid grid-cols-2 gap-2.5 mb-3.5">
                <MysticSelect label="AI 模型" value={aiModel} onChange={(v) => setAiModel(v as AiModelId)} options={AI_MODELS} />
                <MysticSelect label="执棋" value={colorChoice} onChange={(v) => setColorChoice(v as ColorChoice)} options={COLOR_OPTIONS} />
              </div>
              <MysticBtn onClick={() => onLocalPlay(aiModel, colorChoice)} color="cyan">开始对弈</MysticBtn>
            </MysticCard>

            {/* 2. Training */}
            <MysticCard icon="🧪" title="训练模式" subtitle="自由落子" delay={210}>
              <div className="flex items-center gap-3 mb-3.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={analyze} onChange={(e) => setAnalyze(e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-purple-400" />
                  <span className="text-[11px] font-mono text-slate-500">AI 分析</span>
                </label>
                {analyze && (
                  <div className="flex-1">
                    <MysticSelect label="" value={trainModel} onChange={(v) => setTrainModel(v as AiModelId)} options={AI_MODELS} />
                  </div>
                )}
              </div>
              <MysticBtn onClick={() => onTraining(analyze, trainModel)} color="purple">进入训练</MysticBtn>
            </MysticCard>

            {/* 3. AI vs AI */}
            <MysticCard icon="🤖" title="AI 对抗" subtitle="观赏模式" delay={300}>
              <div className="grid grid-cols-2 gap-2.5 mb-3.5">
                <MysticSelect label="⚫ 黑方" value={dualModelBlack} onChange={(v) => setDualModelBlack(v as AiModelId)} options={AI_MODELS} />
                <MysticSelect label="⚪ 白方" value={dualModelWhite} onChange={(v) => setDualModelWhite(v as AiModelId)} options={AI_MODELS} />
              </div>
              <MysticBtn onClick={() => onDualAi(dualModelBlack, dualModelWhite)} color="orange">开始观赏</MysticBtn>
            </MysticCard>

            {/* 4. Multiplayer */}
            <MysticCard icon="👥" title="多人对战" subtitle="实时匹配" delay={390}>
              <div className="flex gap-2.5">
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  placeholder="输入房间名..."
                  className="flex-1 bg-white/[0.04] text-slate-200 px-3 py-2.5 rounded-lg outline-none border border-white/[0.06] hover:border-white/[0.12] focus:border-amber-400/30 placeholder-slate-600 font-mono text-xs transition-all duration-300"
                />
                <button
                  onClick={handleSubmit}
                  disabled={!roomId.trim() || status === "connecting"}
                  className="px-5 py-2.5 rounded-lg font-mono text-xs tracking-wide transition-all duration-300 bg-gradient-to-r from-emerald-400/15 to-green-500/10 border border-emerald-400/15 hover:border-emerald-400/30 hover:-translate-y-[1px] text-emerald-300 disabled:opacity-30"
                >
                  {status === "connecting" ? "连接中" : "加入"}
                </button>
              </div>
              {error && (
                <p className="text-red-400/80 text-[10px] font-mono mt-2 text-center">
                  {error === "Connection error" ? "无法连接服务器" : error}
                </p>
              )}
            </MysticCard>
          </div>

          {/* Footer */}
          <div className="text-center mt-8 text-[10px] font-mono space-x-3 text-slate-700"
            style={{ animation: "fadeUp 0.8s cubic-bezier(0.22,1,0.36,1) 500ms both" }}>
            <a href="https://github.com/WLDKK/3d-connect6/blob/main/RULES.md" target="_blank" rel="noopener"
              className="hover:text-slate-500 transition-colors duration-300">📖 规则</a>
            <span className="text-slate-800">·</span>
            <a href="https://github.com/WLDKK/3d-connect6" target="_blank" rel="noopener"
              className="hover:text-slate-500 transition-colors duration-300">GitHub</a>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Room Status (in-game overlay) ── */
interface RoomStatusProps { roomId: string; }

export function RoomStatus({ roomId }: RoomStatusProps) {
  const { status, playerColor, roomInfo, timer, error } = useWebSocketState();
  const [remaining, setRemaining] = useState(0);

  const colorName = playerColor === Player.BLACK ? "黑方" : playerColor === Player.WHITE ? "白方" : "观战";
  const isConnected = status === "connected";
  const playerCount = roomInfo ? (roomInfo.players.black ? 1 : 0) + (roomInfo.players.white ? 1 : 0) : 0;
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

  const timerColor = remaining <= 15 ? "text-red-400" : remaining <= 30 ? "text-yellow-400" : "text-slate-500";

  return (
    <div className="absolute bottom-16 right-4 font-mono text-xs pointer-events-none select-none">
      <div className="mystic-card !p-3 !rounded-lg">
        <div className="text-slate-600 text-[10px] mb-1">房间: {roomId}</div>
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-green-400" : "bg-red-400"}`} />
          <span className={playerColor === Player.BLACK ? "text-slate-300" : "text-white"}>{colorName}</span>
          <span className="text-slate-600">· {playerCount}/2</span>
        </div>
        {timer && !isGameOver && remaining > 0 && (
          <div className={`text-[11px] mt-1 font-bold ${timerColor}`}>
            ⏳ {remaining}s{isMyTurn && " — 你的回合"}
          </div>
        )}
        {error && <div className="text-red-400/80 text-[10px] mt-1">{error}</div>}
      </div>
    </div>
  );
}
