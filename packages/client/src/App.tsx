import { Suspense, lazy, useCallback, useState, useEffect, useRef } from "react";
import { ControlPanel } from "./components/ControlPanel";
import { SliceMonitor } from "./components/SliceMonitor";
import { Lobby, RoomStatus } from "./components/Lobby";
import { GameStoreContext, useCreateGameStore, useGameSnapshot, useGameActions } from "./hooks/useGameStore";
import { useWebSocketState, useWebSocketActions } from "./hooks/useWebSocket";
import { useViewState } from "./hooks/useViewStore";
import { AiController } from "./components/AiController";
import { TrainingAnalysis } from "./components/TrainingAnalysis";
import { ReplayControls } from "./components/ReplayControls";
import { CoordInput } from "./components/CoordInput";
import { useReplayState, useReplayActions, updateReplayMoves, getReplayBoard, resetReplay } from "./hooks/useReplayStore";
import { Player, Stone, type StatePayload, type ColorChoice, type Vec3 } from "@connect6/shared";

import { WS_BASE } from "./config";

const GameBoard = lazy(() => import("./components/GameBoard"));

function randomPlayer(): Player.BLACK | Player.WHITE {
  return crypto.getRandomValues(new Uint8Array(1))[0] < 128
    ? Player.BLACK
    : Player.WHITE;
}

function HUD({ mode, aiThinking, onResetRequest, gameMode, interactionHint }: {
  mode: "local" | "online"; aiThinking: boolean;
  onResetRequest: () => void;
  gameMode: "normal" | "training" | "dual_ai";
  interactionHint: string;
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
  const stoneCount = snapshot.board.reduce((n, s) => s !== 0 ? n + 1 : n, 0);
  const isDraw = snapshot.winner === Stone.EMPTY && stoneCount === snapshot.board.length;
  const isGameOver = snapshot.winner !== Stone.EMPTY || isDraw;
  const winnerName = snapshot.winner === Player.BLACK ? "黑方" : snapshot.winner === Player.WHITE ? "白方" : "";

  const handleResetClick = () => {
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
      if (status === "connected") {
        onResetRequest();
      } else {
        reset();
      }
    }
  };

  const handleConfirmNo = () => {
    setShowConfirm(false);
  };

  return (
    <div className={`game-hud game-hud-card absolute top-4 left-4 ${accent} font-mono text-sm pointer-events-none select-none`}>
      <p className={`text-[9px] tracking-[0.24em] uppercase ${accentMuted}`}>Connect6 · Spatial</p>
      <h1 className="text-xl font-semibold tracking-[0.08em] mt-0.5 mb-1">3D 六子棋</h1>
      <p className={`text-[10px] ${accentMuted} mb-2`}>
        {gameMode === "training" ? "训练" : gameMode === "dual_ai" ? "AI 对抗" : mode === "local" ? "单机" : "多人"}
        {gameMode !== "training" && " · 本地竞技引擎"}
        {" · 棋子 "}{stoneCount}
      </p>
      {isGameOver ? (
        <div>
          <p className="text-lg text-yellow-400 font-bold">{isDraw ? "棋盘已满，和棋" : `${winnerName} 获胜！`}</p>
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
            第 {snapshot.round} 回合 · <span className={`turn-stone ${isBlack ? "turn-stone-black" : "turn-stone-white"}`} />{playerName}
          </p>
          <p className={`text-sm font-bold ${isDark ? (isBlack ? "text-gray-300" : "text-white") : (isBlack ? "text-gray-800" : "text-black")}`}>
            {aiThinking ? "AI 思考中..." : `${playerName}落子`}
            {snapshot.round > 0 && `（本回合剩余 ${2 - snapshot.stonesPlacedThisTurn} 枚）`}
          </p>
          <p className={`mt-1 text-[10px] ${accentMuted}`}>{interactionHint}</p>
          <button
            className="mt-1.5 px-2 py-0.5 bg-red-900/30 text-red-400 text-[10px] rounded pointer-events-auto hover:bg-red-900/50 transition-colors"
            onClick={handleResetClick}
          >
            清空棋盘
          </button>
        </div>
      )}

      {showConfirm && (
        <div className="fixed inset-0 flex items-center justify-center z-[100] bg-black/50">
          <div className="bg-black/90 backdrop-blur-md border border-cyber-grid rounded-xl p-6 text-center pointer-events-auto">
            <p className="text-cyber-accent font-mono text-sm mb-4">
              {mode === "local" ? "确定要清空棋盘吗？" : "确定要申请重置吗？双方确认后将清空棋盘。"}
            </p>
            <div className="flex gap-3 justify-center">
              <button onClick={handleConfirmYes} className="px-4 py-1.5 bg-red-900/40 text-red-400 rounded hover:bg-red-900/60 font-mono text-xs transition-colors">确定</button>
              <button onClick={handleConfirmNo} className="px-4 py-1.5 bg-cyber-grid text-cyber-accent/70 rounded hover:bg-cyber-grid/80 font-mono text-xs transition-colors">取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MultiplayerSync({ roomId }: { roomId: string }) {
  const { loadState, setSendMove } = useGameActions();
  const { sendMove, setOnStateUpdate, setOnGameStart } = useWebSocketActions();
  const movesRef = useRef<Vec3[]>([]);

  useEffect(() => {
    setSendMove(sendMove);
    return () => setSendMove(null);
  }, [sendMove, setSendMove]);

  useEffect(() => {
    setOnStateUpdate((payload: StatePayload) => {
      // Detect reset: round 0 with no lastMove
      if (payload.round === 0 && !payload.lastMove) {
        movesRef.current = [];
      } else if (payload.lastMove) {
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

  useEffect(() => {
    setOnGameStart((state) => {
      movesRef.current = [...state.moves];
      loadState(state);
    });
    return () => setOnGameStart(null);
  }, [loadState, setOnGameStart]);

  return null;
}

function GameContent({ roomId, aiColor, gameMode, trainingAnalyze, onBack }: {
  roomId: string | null; aiColor: Player | null;
  gameMode: "normal" | "training" | "dual_ai";
  trainingAnalyze: boolean;
  onBack: () => void;
}) {
  const snapshot = useGameSnapshot();
  const { reset, placeStone } = useGameActions();
  const [previewCoords, setPreviewCoords] = useState<{ x: number; y: number; z: number } | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [waitingReset, setWaitingReset] = useState(false);
  const [waitingReady, setWaitingReady] = useState(false);

  const { sendResetRequest, sendResetConfirm, sendResetReject, sendReady } = useWebSocketActions();
  const { pendingReset, lastResetAck, showReadyDialog, timer, movePending, playerColor, status: connectionStatus } = useWebSocketState();
  const replayState = useReplayState();
  const { goLatest } = useReplayActions();

  useEffect(() => { updateReplayMoves(snapshot.moves); }, [snapshot.moves]);

  const replayBoard = !replayState.isLive ? getReplayBoard(snapshot, replayState.viewIndex) : null;
  const hasWinner = snapshot.winner !== Stone.EMPTY;
  const isDraw = !hasWinner && snapshot.board.every((stone) => stone !== Stone.EMPTY);
  const isGameOver = hasWinner || isDraw;

  useEffect(() => { if (pendingReset) setShowResetDialog(true); }, [pendingReset]);
  useEffect(() => { if (timer) setWaitingReady(false); }, [timer]);
  useEffect(() => { if (lastResetAck) setWaitingReset(false); }, [lastResetAck]);

  const handleResetRequest = useCallback(() => {
    if (!roomId) { reset(); return; }
    sendResetRequest();
    if (!isGameOver) setWaitingReset(true);
  }, [roomId, isGameOver, sendResetRequest, reset]);

  const handleResetConfirm = useCallback(() => {
    sendResetConfirm();
    setShowResetDialog(false);
  }, [sendResetConfirm]);

  const handleResetCancel = useCallback(() => {
    sendResetReject();
    setShowResetDialog(false);
  }, [sendResetReject]);
  const handleResetWithdraw = useCallback(() => {
    sendResetReject();
    setWaitingReset(false);
  }, [sendResetReject]);
  const handleReady = useCallback(() => { sendReady(); setWaitingReady(true); }, [sendReady]);

  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const { theme } = useViewState();
  const bgColor = theme === "dark" ? "#0a0e17" : "#f5f0e6";
  const bgClass = theme === "dark" ? "bg-cyber-bg" : "bg-gray-100";

  const isReplay = !replayState.isLive;
  const onlineLocked = Boolean(roomId) && (
    connectionStatus !== "connected"
    || showReadyDialog
    || !timer
    || movePending
    || playerColor === null
    || playerColor !== snapshot.currentPlayer
  );
  const aiLocked = gameMode === "dual_ai"
    || (gameMode === "normal" && aiColor === snapshot.currentPlayer);
  const interactionDisabled = isGameOver || isReplay || onlineLocked || aiLocked || aiThinking;
  const interactionHint = isGameOver
    ? "本局已结束"
    : isReplay
      ? "回放中，返回最新局面后可落子"
      : roomId && playerColor === null
        ? "当前为观战席"
        : roomId && connectionStatus !== "connected"
          ? "正在连接房间"
          : roomId && movePending
            ? "正在确认落子"
          : roomId && (showReadyDialog || !timer)
            ? "等待双方准备"
            : onlineLocked
              ? "等待对手落子"
              : aiLocked || aiThinking
                ? "AI 正在思考"
                : "点击棋盘或输入坐标落子";

  const handleScenePlace = useCallback((grid: Vec3) => {
    if (interactionDisabled) return;
    if (placeStone(grid.x, grid.y, grid.z)) setPreviewCoords(null);
  }, [interactionDisabled, placeStone]);

  return (
    <div className={`game-shell w-full h-full relative ${bgClass}`}>
      {roomId && <MultiplayerSync roomId={roomId} />}
      {gameMode === "normal" && aiColor && (
        <AiController aiColor={aiColor} onThinking={setAiThinking} />
      )}
      {gameMode === "dual_ai" && (
        <AiController aiColor={snapshot.currentPlayer} onThinking={setAiThinking} />
      )}

      <Suspense fallback={(
        <div className="absolute inset-0 grid place-items-center font-mono text-sm text-cyber-accent/70">
          正在加载 3D 棋盘…
        </div>
      )}>
        <GameBoard
          backgroundColor={bgColor}
          previewCoords={previewCoords}
          replayBoard={replayBoard}
          interactionDisabled={interactionDisabled}
          onPlace={handleScenePlace}
        />
      </Suspense>

      <HUD
        mode={roomId ? "online" : "local"}
        aiThinking={aiThinking}
        onResetRequest={handleResetRequest}
        gameMode={gameMode}
        interactionHint={interactionHint}
      />
      <div className="game-side-panel absolute top-4 right-4 flex flex-col gap-2">
        <ControlPanel />
        <SliceMonitor />
        {gameMode === "training" && trainingAnalyze && <TrainingAnalysis />}
      </div>
      <CoordInput
        onPreview={setPreviewCoords}
        disabled={interactionDisabled}
        disabledReason={interactionHint}
      />
      <ReplayControls />
      {roomId && <RoomStatus roomId={roomId} />}

      {/* Back button */}
      <div className="game-back absolute bottom-4 right-4 pointer-events-auto">
        <button
          onClick={() => setShowBackConfirm(true)}
          className={`px-3 py-1.5 ${theme === "dark" ? "bg-cyber-grid/70 text-cyber-accent/70 hover:bg-cyber-grid" : "bg-gray-200/70 text-gray-600 hover:bg-gray-200"} backdrop-blur-sm border ${theme === "dark" ? "border-cyber-grid" : "border-gray-300"} rounded-lg font-mono text-xs transition-colors`}
        >
          ← 返回
        </button>
      </div>

      {showBackConfirm && (
        <div className="absolute inset-0 flex items-center justify-center z-[100] bg-black/50">
          <div className="bg-black/90 backdrop-blur-md border border-cyber-grid rounded-xl p-6 text-center pointer-events-auto">
            <p className="text-cyber-accent font-mono text-sm mb-4">确定返回主页面吗？</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => { setShowBackConfirm(false); onBack(); }} className="px-4 py-1.5 bg-red-900/40 text-red-400 rounded hover:bg-red-900/60 font-mono text-xs transition-colors">确定</button>
              <button onClick={() => setShowBackConfirm(false)} className="px-4 py-1.5 bg-cyber-grid text-cyber-accent/70 rounded hover:bg-cyber-grid/80 font-mono text-xs transition-colors">取消</button>
            </div>
          </div>
        </div>
      )}

      {showReadyDialog && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/60">
          <div className="bg-black/90 backdrop-blur-md border border-cyber-grid rounded-xl p-8 text-center pointer-events-auto">
            <p className="text-cyber-accent font-mono text-lg mb-2">双方已就位</p>
            {waitingReady ? (
              <>
                <p className="text-yellow-400 font-mono text-sm mb-6">等待对方确认...</p>
                <div className="w-6 h-6 border-2 border-cyber-accent/30 border-t-cyber-accent rounded-full animate-spin mx-auto" />
              </>
            ) : (
              <>
                <p className="text-cyber-accent/50 font-mono text-xs mb-6">点击准备开始游戏</p>
                <button onClick={handleReady} className="px-8 py-2 bg-cyber-accent/20 text-cyber-accent rounded-lg hover:bg-cyber-accent/30 font-mono text-sm transition-colors">准备开始</button>
              </>
            )}
          </div>
        </div>
      )}

      {showResetDialog && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/50">
          <div className="bg-black/90 backdrop-blur-md border border-cyber-grid rounded-xl p-6 text-center pointer-events-auto">
            <p className="text-cyber-accent font-mono text-sm mb-4">对手申请清空棋盘，是否同意？</p>
            <div className="flex gap-3 justify-center">
              <button onClick={handleResetConfirm} className="px-4 py-1.5 bg-red-900/40 text-red-400 rounded hover:bg-red-900/60 font-mono text-xs transition-colors">同意重置</button>
              <button onClick={handleResetCancel} className="px-4 py-1.5 bg-cyber-grid text-cyber-accent/70 rounded hover:bg-cyber-grid/80 font-mono text-xs transition-colors">拒绝</button>
            </div>
          </div>
        </div>
      )}

      {waitingReset && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/50">
          <div className="bg-black/90 backdrop-blur-md border border-cyber-grid rounded-xl p-6 text-center pointer-events-auto">
            <p className="text-cyber-accent font-mono text-sm mb-4">已发送重置申请，等待对手确认...</p>
            <button onClick={handleResetWithdraw} className="px-4 py-1.5 bg-cyber-grid text-cyber-accent/70 rounded hover:bg-cyber-grid/80 font-mono text-xs transition-colors">撤回申请</button>
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
  const [gameMode, setGameMode] = useState<"normal" | "training" | "dual_ai">("normal");
  const [trainingAnalyze, setTrainingAnalyze] = useState(false);
  const { connect, disconnect } = useWebSocketActions();

  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);

  const handleEnterRoom = useCallback((id: string) => {
    store.reset(); resetReplay(); setRoomId(id); setInGame(true);
    setAiColor(null); setGameMode("normal");
    connect(`${WS_BASE}/api/room/${encodeURIComponent(id)}`);
  }, [connect, store]);

  const handleLocalPlay = useCallback((color: ColorChoice) => {
    disconnect(); store.reset(); resetReplay();
    setRoomId(null); setInGame(true); setGameMode("normal");
    if (color === "random") setAiColor(randomPlayer());
    else setAiColor(color === "black" ? Player.WHITE : Player.BLACK);
  }, [store, disconnect]);

  const handleTraining = useCallback((analyze: boolean) => {
    disconnect(); store.reset(); resetReplay();
    setRoomId(null); setInGame(true); setAiColor(null);
    setGameMode("training"); setTrainingAnalyze(analyze);
  }, [store, disconnect]);

  const handleDualAi = useCallback(() => {
    disconnect(); store.reset(); resetReplay();
    setRoomId(null); setInGame(true); setAiColor(Player.WHITE);
    setGameMode("dual_ai");
  }, [store, disconnect]);

  const handleLeaveRoom = useCallback(() => {
    disconnect(); store.reset(); resetReplay();
    setRoomId(null); setInGame(false); setAiColor(null); setGameMode("normal");
  }, [disconnect, store]);

  return (
    <GameStoreContext.Provider value={store}>
      {inGame ? (
        <GameContent
          roomId={roomId} aiColor={aiColor}
          gameMode={gameMode} trainingAnalyze={trainingAnalyze}
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
