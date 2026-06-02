import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Suspense, useCallback, useState, useEffect, useRef } from "react";
import { GameScene } from "./components/GameScene";
import { ControlPanel } from "./components/ControlPanel";
import { SliceMonitor } from "./components/SliceMonitor";
import { Lobby, RoomStatus } from "./components/Lobby";
import { GameStoreContext, useCreateGameStore, useGameSnapshot, useGameActions } from "./hooks/useGameStore";
import { useWebSocketState, useWebSocketActions } from "./hooks/useWebSocket";
import { useViewState } from "./hooks/useViewStore";
import { AiController } from "./components/AiController";
import { TrainingAnalysis } from "./components/TrainingAnalysis";
import { ReplayControls } from "./components/ReplayControls";
import { useAiMemoryActions, useMemoryStats } from "./hooks/useAiMemory";
import { useReplayState, useReplayActions, updateReplayMoves, getReplayBoard, resetReplay } from "./hooks/useReplayStore";
import { Player, Stone, type StatePayload, type AiModelId, type ColorChoice, type Vec3 } from "@connect6/shared";

/**
 * API base URL for Worker (WebSocket + REST).
 * Set VITE_API_URL in .env for separate-domain deployment.
 * Defaults to current origin (works with Vite proxy in dev).
 */
const API_BASE = import.meta.env.VITE_API_URL || (location.hostname.includes("pages.dev")
  ? "https://connect6-server.1310205058.workers.dev"
  : "");
const WS_BASE = API_BASE
  ? API_BASE.replace(/^http/, "ws")
  : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;

const AI_MODEL_LABELS: Record<AiModelId, string> = {
  "local": "本地 AI",
  "qwen3.6-plus": "Qwen 3.6+",
  "qwen3.7-max": "Qwen 3.7 Max",
  "deepseek-v4-flash": "DeepSeek V4",
  "glm-5.1": "GLM 5.1",
};

function HUD({ mode, aiModel, aiSource, aiThinking, onResetRequest, gameMode, memoryEntries, dualAiModels }: {
  mode: "local" | "online"; aiModel: AiModelId;
  aiSource: "llm" | "local" | null; aiThinking: boolean;
  onResetRequest: () => void;
  gameMode: "normal" | "training" | "dual_ai";
  memoryEntries: number;
  dualAiModels: { black: AiModelId; white: AiModelId };
}) {
  const snapshot = useGameSnapshot();
  const { reset } = useGameActions();
  const { status } = useWebSocketState();
  const { theme } = useViewState();
  const [showConfirm, setShowConfirm] = useState(false);

  const isDark = theme === "dark";
  const accent = isDark ? "text-cyber-accent" : "text-gray-900";
  const accentDim = isDark ? "text-cyber-accent/60" : "text-gray-600";
  const accentMuted = isDark ? "text-cyber-accent/40" : "text-gray-500";

  const isBlack = snapshot.currentPlayer === Player.BLACK;
  const playerName = isBlack ? "黑方" : "白方";
  const isGameOver = snapshot.winner !== Stone.EMPTY;
  const winnerName = snapshot.winner === Player.BLACK ? "黑方" : snapshot.winner === Player.WHITE ? "白方" : "";
  const stoneCount = snapshot.board.reduce((n, s) => s !== 0 ? n + 1 : n, 0);
  const aiSourceLabel = aiSource === "llm" ? "☁️ LLM" : aiSource === "local" ? "💻 本地" : "";

  const handleResetClick = () => {
    // Game over in multiplayer — server resets directly, no confirmation needed
    if (isGameOver && mode === "online") {
      onResetRequest();
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirmYes = () => {
    setShowConfirm(false);
    if (mode === "local") {
      reset();
    } else {
      // Multiplayer: send reset request
      if (status === "connected") {
        onResetRequest();
      } else {
        // Not connected — reset locally as fallback
        reset();
      }
    }
  };

  const handleConfirmNo = () => {
    setShowConfirm(false);
  };

  return (
    <div className={`absolute top-4 left-4 ${accent} font-mono text-sm pointer-events-none select-none`}>
      <h1 className="text-2xl font-bold tracking-wider mb-1">3D 六子棋</h1>
      <p className={`text-[10px] ${accentMuted} mb-2`}>
        {gameMode === "training" ? "训练" : gameMode === "dual_ai" ? "AI 对抗" : mode === "local" ? "单机" : "多人"}
        {gameMode === "dual_ai"
          ? ` · ⚫${AI_MODEL_LABELS[dualAiModels.black]} ⚪${AI_MODEL_LABELS[dualAiModels.white]}`
          : gameMode !== "training" && ` · ${AI_MODEL_LABELS[aiModel]}`
        }
        {aiSourceLabel ? ` (${aiSourceLabel})` : ""}
        {" · 棋子 "}{stoneCount}
        {memoryEntries > 0 && ` · 记忆 ${memoryEntries} 条`}
      </p>
      {isGameOver ? (
        <div>
          <p className="text-lg text-yellow-400 font-bold">{winnerName} 获胜！</p>
          <button
            className="mt-2 px-3 py-1 bg-cyber-grid text-cyber-accent text-xs rounded pointer-events-auto hover:bg-opacity-80"
            onClick={handleResetClick}
          >
            新游戏
          </button>
        </div>
      ) : (
        <div>
          <p className={`text-xs ${accentDim}`}>
            第 {snapshot.round} 回合 · {isBlack ? "⚫" : "⚪"}{playerName}
          </p>
          <p className={`text-sm font-bold ${isDark ? (isBlack ? "text-gray-300" : "text-white") : (isBlack ? "text-gray-800" : "text-black")}`}>
            {aiThinking ? "AI 思考中..." : `${playerName}落子`}
            {snapshot.round > 0 && `（本回合剩余 ${2 - snapshot.stonesPlacedThisTurn} 枚）`}
          </p>
          <button
            className="mt-1.5 px-2 py-0.5 bg-red-900/30 text-red-400 text-[10px] rounded pointer-events-auto hover:bg-red-900/50 transition-colors"
            onClick={handleResetClick}
          >
            清空棋盘
          </button>
        </div>
      )}

      {/* Reset confirmation dialog */}
      {showConfirm && (
        <div className="fixed inset-0 flex items-center justify-center z-[100] bg-black/50">
          <div className="bg-black/90 backdrop-blur-md border border-cyber-grid rounded-xl p-6 text-center pointer-events-auto">
            <p className="text-cyber-accent font-mono text-sm mb-4">
              {mode === "local"
                ? "确定要清空棋盘吗？"
                : "确定要申请重置吗？双方确认后将清空棋盘。"}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleConfirmYes}
                className="px-4 py-1.5 bg-red-900/40 text-red-400 rounded hover:bg-red-900/60 font-mono text-xs transition-colors"
              >
                确定
              </button>
              <button
                onClick={handleConfirmNo}
                className="px-4 py-1.5 bg-cyber-grid text-cyber-accent/70 rounded hover:bg-cyber-grid/80 font-mono text-xs transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function parseUserCoords(raw: string): [number, number, number] | null {
  const trimmed = raw.trim();
  let parts: number[];
  if (/^\d{3}$/.test(trimmed)) {
    parts = trimmed.split("").map(Number);
  } else {
    parts = trimmed.split(/[,，\s]+/).filter(Boolean).map((s) => parseInt(s, 10));
  }
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return [parts[0], parts[1], parts[2]];
}

function CoordInput({ onPreview }: { onPreview: (coords: { x: number; y: number; z: number } | null) => void }) {
  const snapshot = useGameSnapshot();
  const { placeStone } = useGameActions();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const { sizeX, sizeY, sizeZ } = snapshot.config;

  const toGrid = useCallback((ux: number, uy: number, uz: number) => ({
    x: sizeX - 1 - ux, y: uy, z: uz,
  }), [sizeX]);

  const tryPreview = useCallback((val: string) => {
    setError("");
    const parsed = parseUserCoords(val);
    if (!parsed) { onPreview(null); return; }
    const [ux, uy, uz] = parsed;
    if (ux < 0 || ux >= sizeX || uy < 0 || uy >= sizeY || uz < 0 || uz >= sizeZ) {
      onPreview(null); return;
    }
    const g = toGrid(ux, uy, uz);
    const idx = g.z * sizeY * sizeX + g.y * sizeX + g.x;
    if (snapshot.board[idx] !== Stone.EMPTY || snapshot.winner !== Stone.EMPTY) {
      onPreview(null); return;
    }
    onPreview(g);
  }, [snapshot, sizeX, sizeY, sizeZ, toGrid, onPreview]);

  const handleSubmit = useCallback(() => {
    setError("");
    const parsed = parseUserCoords(input);
    if (!parsed) {
      setError("格式：x,y,z 或 xyz（如 1,2,3 或 222）");
      setInput(""); onPreview(null); return;
    }
    const [ux, uy, uz] = parsed;
    if (ux < 0 || ux >= sizeX || uy < 0 || uy >= sizeY || uz < 0 || uz >= sizeZ) {
      setError(`坐标越界（范围 0~${sizeX - 1}）`);
      setInput(""); onPreview(null); return;
    }
    const g = toGrid(ux, uy, uz);
    const idx = g.z * sizeY * sizeX + g.y * sizeX + g.x;
    if (snapshot.board[idx] !== Stone.EMPTY) {
      setError("该位置已有棋子");
      setInput(""); onPreview(null); return;
    }
    if (snapshot.winner !== Stone.EMPTY) {
      setError("游戏已结束");
      setInput(""); onPreview(null); return;
    }
    placeStone(g.x, g.y, g.z);
    setInput("");
    onPreview(null);
  }, [input, snapshot, sizeX, sizeY, sizeZ, toGrid, placeStone, onPreview]);

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-xs">
      <div className="bg-black/70 backdrop-blur-sm border border-cyber-grid rounded-lg px-4 py-2 flex items-center gap-2">
        <span className="text-cyber-accent opacity-70">坐标输入</span>
        <input
          type="text"
          value={input}
          onChange={(e) => { setInput(e.target.value); tryPreview(e.target.value); }}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="x,y,z"
          title="支持格式：x,y,z / x，y，z / xyz / x y z"
          className="bg-cyber-grid/50 text-white px-2 py-1 rounded w-28 outline-none border border-transparent focus:border-cyber-accent text-center"
        />
        <button
          onClick={handleSubmit}
          className="px-3 py-1 bg-cyber-accent/20 text-cyber-accent rounded hover:bg-cyber-accent/30 transition-colors"
        >
          落子
        </button>
        {error && <span className="text-red-400 ml-2">{error}</span>}
      </div>
    </div>
  );
}

/**
 * Multiplayer sync layer — sits INSIDE GameStoreContext.Provider.
 * Wires WebSocket state updates to the game store.
 */
function MultiplayerSync({ roomId }: { roomId: string }) {
  const { loadState, setSendMove } = useGameActions();
  const { sendMove, setOnStateUpdate, setOnGameStart } = useWebSocketActions();
  // Accumulate moves on client side (server STATE messages only include lastMove)
  const movesRef = useRef<Vec3[]>([]);

  // Wire sendMove to game store
  useEffect(() => {
    setSendMove(sendMove);
    return () => setSendMove(null);
  }, [sendMove, setSendMove]);

  // Handle state updates from server
  useEffect(() => {
    setOnStateUpdate((payload: StatePayload) => {
      // Accumulate moves
      if (payload.lastMove) {
        movesRef.current.push(payload.lastMove);
      }
      loadState({
        config: { sizeX: 10, sizeY: 10, sizeZ: 10, winLength: 6 },
        board: payload.board,
        currentPlayer: payload.currentPlayer,
        round: payload.round,
        stonesPlacedThisTurn: payload.stonesPlacedThisTurn,
        winner: payload.winner,
        moves: [...movesRef.current],
      });
    });
    return () => setOnStateUpdate(null);
  }, [loadState, setOnStateUpdate]);

  // Handle initial room info snapshot
  useEffect(() => {
    setOnGameStart((state) => {
      movesRef.current = [...state.moves]; // Initialize with full history
      loadState(state);
    });
    return () => setOnGameStart(null);
  }, [loadState, setOnGameStart]);

  return null;
}

/** Game view — the full 3D scene with controls */
function GameContent({ roomId, aiColor, aiModel, gameMode, trainingAnalyze, dualAiModels, onBack }: {
  roomId: string | null; aiColor: Player | null; aiModel: AiModelId;
  gameMode: "normal" | "training" | "dual_ai";
  trainingAnalyze: boolean;
  dualAiModels: { black: AiModelId; white: AiModelId };
  onBack: () => void;
}) {
  const snapshot = useGameSnapshot();
  const { reset } = useGameActions();
  const [previewCoords, setPreviewCoords] = useState<{ x: number; y: number; z: number } | null>(null);
  const [aiSource, setAiSource] = useState<"llm" | "local" | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [waitingReset, setWaitingReset] = useState(false);
  const [waitingReady, setWaitingReady] = useState(false);

  const { sendResetRequest, sendResetConfirm, sendReady } = useWebSocketActions();
  const { pendingReset, showReadyDialog, timer } = useWebSocketState();
  const { learn: learnFromGame } = useAiMemoryActions();
  const memoryStats = useMemoryStats();
  const replayState = useReplayState();
  const { goLatest } = useReplayActions();

  // Sync replay moves when snapshot changes
  useEffect(() => {
    updateReplayMoves(snapshot.moves);
  }, [snapshot.moves]);

  // Compute replay board (null = use live snapshot)
  const replayBoard = !replayState.isLive
    ? getReplayBoard(snapshot, replayState.viewIndex)
    : null;

  const isGameOver = snapshot.winner !== Stone.EMPTY;

  // Learn from completed games
  useEffect(() => {
    if (isGameOver && snapshot.moves.length > 0) {
      learnFromGame(snapshot);
    }
  }, [isGameOver]);

  // Show dialog when other player requests reset
  useEffect(() => {
    if (pendingReset) setShowResetDialog(true);
  }, [pendingReset]);

  // Reset waitingReady when game starts (timer received)
  useEffect(() => {
    if (timer) setWaitingReady(false);
  }, [timer]);

  // Clear waiting state when reset completes
  useEffect(() => {
    if (!pendingReset) setWaitingReset(false);
  }, [pendingReset]);

  const handleResetRequest = useCallback(() => {
    if (!roomId) {
      // Single player — direct reset
      reset();
      return;
    }
    // Multiplayer
    if (isGameOver) {
      // Game over — send request, server resets directly (no confirmation needed)
      sendResetRequest();
    } else {
      // Game in progress — need opponent confirmation
      sendResetRequest();
      setWaitingReset(true);
    }
  }, [roomId, isGameOver, sendResetRequest, reset]);

  const handleResetConfirm = useCallback(() => {
    sendResetConfirm();
    setShowResetDialog(false);
  }, [sendResetConfirm]);

  const [showBackConfirm, setShowBackConfirm] = useState(false);

  const handleResetCancel = useCallback(() => {
    setShowResetDialog(false);
  }, []);

  const handleReady = useCallback(() => {
    sendReady();
    setWaitingReady(true);
  }, [sendReady]);

  const { theme } = useViewState();
  const bgColor = theme === "dark" ? "#0a0e17" : "#f5f0e6";
  const bgClass = theme === "dark" ? "bg-cyber-bg" : "bg-gray-100";

  return (
    <div className={`w-full h-full relative ${bgClass}`}>
      {roomId && <MultiplayerSync roomId={roomId} />}
      {/* Normal AI: one AI opponent */}
      {gameMode === "normal" && aiColor && (
        <AiController aiColor={aiColor} model={aiModel} onAiSource={setAiSource} onThinking={setAiThinking} />
      )}
      {/* Dual AI: both sides controlled by AI */}
      {gameMode === "dual_ai" && (
        <>
          <AiController aiColor={Player.BLACK} model={dualAiModels.black} onAiSource={setAiSource} onThinking={setAiThinking} />
          <AiController aiColor={Player.WHITE} model={dualAiModels.white} onAiSource={setAiSource} onThinking={setAiThinking} />
        </>
      )}

      <Canvas
        camera={{ position: [18, -18, 16], fov: 45, up: [0, 0, 1] }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
      >
        <color attach="background" args={[bgColor]} />
        <fog attach="fog" args={[bgColor, 25, 60]} />
        <Suspense fallback={null}>
          <GameScene previewCoords={previewCoords} replayBoard={replayBoard} />
        </Suspense>
        <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
      </Canvas>

      <HUD
        mode={roomId ? "online" : "local"}
        aiModel={aiModel}
        aiSource={aiSource}
        aiThinking={aiThinking}
        onResetRequest={handleResetRequest}
        gameMode={gameMode}
        memoryEntries={memoryStats.entries}
        dualAiModels={dualAiModels}
      />
      <div className="absolute top-4 right-4 flex flex-col gap-2">
        <ControlPanel />
        <SliceMonitor />
        {gameMode === "training" && trainingAnalyze && <TrainingAnalysis />}
      </div>
      <CoordInput onPreview={setPreviewCoords} />
      <ReplayControls />
      {roomId && <RoomStatus roomId={roomId} />}

      {/* Back button */}
      <div className="absolute bottom-4 right-4 pointer-events-auto">
        <button
          onClick={() => setShowBackConfirm(true)}
          className={`px-3 py-1.5 ${theme === "dark" ? "bg-cyber-grid/70 text-cyber-accent/70 hover:bg-cyber-grid" : "bg-gray-200/70 text-gray-600 hover:bg-gray-200"} backdrop-blur-sm border ${theme === "dark" ? "border-cyber-grid" : "border-gray-300"} rounded-lg font-mono text-xs transition-colors`}
        >
          ← 返回
        </button>
      </div>

      {/* Back confirmation dialog */}
      {showBackConfirm && (
        <div className="absolute inset-0 flex items-center justify-center z-[100] bg-black/50">
          <div className="bg-black/90 backdrop-blur-md border border-cyber-grid rounded-xl p-6 text-center pointer-events-auto">
            <p className="text-cyber-accent font-mono text-sm mb-4">确定返回主页面吗？</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => { setShowBackConfirm(false); onBack(); }}
                className="px-4 py-1.5 bg-red-900/40 text-red-400 rounded hover:bg-red-900/60 font-mono text-xs transition-colors"
              >
                确定
              </button>
              <button
                onClick={() => setShowBackConfirm(false)}
                className="px-4 py-1.5 bg-cyber-grid text-cyber-accent/70 rounded hover:bg-cyber-grid/80 font-mono text-xs transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ready dialog — shown to both players when both are in the room */}
      {showReadyDialog && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/60">
          <div className="bg-black/90 backdrop-blur-md border border-cyber-grid rounded-xl p-8 text-center pointer-events-auto">
            <p className="text-cyber-accent font-mono text-lg mb-2">双方已就位</p>
            {waitingReady ? (
              <>
                <p className="text-yellow-400 font-mono text-sm mb-6">⏳ 等待对方确认...</p>
                <div className="w-6 h-6 border-2 border-cyber-accent/30 border-t-cyber-accent rounded-full animate-spin mx-auto" />
              </>
            ) : (
              <>
                <p className="text-cyber-accent/50 font-mono text-xs mb-6">点击准备开始游戏</p>
                <button
                  onClick={handleReady}
                  className="px-8 py-2 bg-cyber-accent/20 text-cyber-accent rounded-lg hover:bg-cyber-accent/30 font-mono text-sm transition-colors"
                >
                  准备开始
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Reset confirmation dialog (shown to opponent only) */}
      {showResetDialog && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/50">
          <div className="bg-black/90 backdrop-blur-md border border-cyber-grid rounded-xl p-6 text-center pointer-events-auto">
            <p className="text-cyber-accent font-mono text-sm mb-4">
              对手申请清空棋盘，是否同意？
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleResetConfirm}
                className="px-4 py-1.5 bg-red-900/40 text-red-400 rounded hover:bg-red-900/60 font-mono text-xs transition-colors"
              >
                同意重置
              </button>
              <button
                onClick={handleResetCancel}
                className="px-4 py-1.5 bg-cyber-grid text-cyber-accent/70 rounded hover:bg-cyber-grid/80 font-mono text-xs transition-colors"
              >
                拒绝
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Waiting for opponent to confirm reset (shown to initiator) */}
      {waitingReset && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/50">
          <div className="bg-black/90 backdrop-blur-md border border-cyber-grid rounded-xl p-6 text-center pointer-events-auto">
            <p className="text-cyber-accent font-mono text-sm mb-4">
              已发送重置申请，等待对手确认...
            </p>
            <button
              onClick={() => setWaitingReset(false)}
              className="px-4 py-1.5 bg-cyber-grid text-cyber-accent/70 rounded hover:bg-cyber-grid/80 font-mono text-xs transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const store = useCreateGameStore();
  const { theme } = useViewState();
  const [roomId, setRoomId] = useState<string | null>(null);
  const [inGame, setInGame] = useState(false);
  const [aiColor, setAiColor] = useState<Player | null>(null);
  const [aiModel, setAiModel] = useState<AiModelId>("local");
  const [gameMode, setGameMode] = useState<"normal" | "training" | "dual_ai">("normal");
  const [trainingAnalyze, setTrainingAnalyze] = useState(false);
  const [dualAiModels, setDualAiModels] = useState<{ black: AiModelId; white: AiModelId }>({ black: "local", white: "local" });
  const { connect, disconnect } = useWebSocketActions();

  // Apply theme to root element
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const handleEnterRoom = useCallback((id: string) => {
    store.reset();
    resetReplay();
    setRoomId(id);
    setInGame(true);
    setAiColor(null);
    setAiModel("local");
    setGameMode("normal");
    const wsUrl = `${WS_BASE}/api/room/${encodeURIComponent(id)}`;
    connect(wsUrl);
  }, [connect, store]);

  const handleLocalPlay = useCallback((model: AiModelId, color: ColorChoice) => {
    disconnect();
    store.reset();
    resetReplay();
    setRoomId(null);
    setInGame(true);
    setAiModel(model);
    setGameMode("normal");
    if (color === "random") {
      setAiColor(Math.random() < 0.5 ? Player.WHITE : Player.BLACK);
    } else {
      setAiColor(color === "black" ? Player.WHITE : Player.BLACK);
    }
  }, [store, disconnect]);

  const handleTraining = useCallback((analyze: boolean) => {
    disconnect();
    store.reset();
    resetReplay();
    setRoomId(null);
    setInGame(true);
    setAiColor(null);
    setAiModel("local");
    setGameMode("training");
    setTrainingAnalyze(analyze);
  }, [store, disconnect]);

  const handleDualAi = useCallback((modelBlack: AiModelId, modelWhite: AiModelId) => {
    disconnect();
    store.reset();
    resetReplay();
    setRoomId(null);
    setInGame(true);
    setAiColor(Player.WHITE);
    setAiModel(modelWhite);
    setGameMode("dual_ai");
    setDualAiModels({ black: modelBlack, white: modelWhite });
  }, [store, disconnect]);

  const handleLeaveRoom = useCallback(() => {
    disconnect();
    store.reset();
    resetReplay();
    setRoomId(null);
    setInGame(false);
    setAiColor(null);
    setGameMode("normal");
  }, [disconnect, store]);

  return (
    <GameStoreContext.Provider value={store}>
      {inGame ? (
        <GameContent
          roomId={roomId}
          aiColor={aiColor}
          aiModel={aiModel}
          gameMode={gameMode}
          trainingAnalyze={trainingAnalyze}
          dualAiModels={dualAiModels}
          onBack={handleLeaveRoom}
        />
      ) : (
        <Lobby
          onEnterRoom={handleEnterRoom}
          onLocalPlay={handleLocalPlay}
          onTraining={handleTraining}
          onDualAi={handleDualAi}
        />
      )}
    </GameStoreContext.Provider>
  );
}
