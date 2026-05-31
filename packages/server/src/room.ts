import { DurableObject } from "cloudflare:workers";
import {
  Connect6Engine,
  type SerializedState,
  MsgType,
  Player,
  Stone,
  type WsMessage,
  type MovePayload,
  type PlayerAssignedPayload,
  type RoomInfoPayload,
  type StatePayload,
  type ResetRequestPayload,
} from "@connect6/shared";

interface PlayerMeta {
  color: Player.BLACK | Player.WHITE;
}

interface TimerPayload {
  currentPlayer: Player;
  remainingMs: number;
  turnStartTime: number;
}

const TURN_TIMEOUT_MS = 300_000; // 5 minutes

export class GameRoom extends DurableObject {
  private engine!: Connect6Engine;
  private playerBlack: WebSocket | null = null;
  private playerWhite: WebSocket | null = null;
  private observers: Set<WebSocket> = new Set();
  private turnStartTime: number = 0;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private resetConfirmations: Set<Player> = new Set();
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  /** Players who clicked "ready" */
  private readyPlayers: Set<WebSocket> = new Set();
  private gameStarted: boolean = false;

  async fetch(request: Request): Promise<Response> {
    await this.ensureEngine();

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    return this.handleInfoRequest();
  }

  private handleInfoRequest(): Response {
    return Response.json({
      players: {
        black: this.playerBlack !== null,
        white: this.playerWhite !== null,
      },
      state: this.engine.toJSON(),
    });
  }

  private async ensureEngine(): Promise<void> {
    if (this.engine) return;
    const stored = await this.ctx.storage.get<SerializedState>("gameState");
    this.engine = stored ? Connect6Engine.fromJSON(stored) : new Connect6Engine();
    this.gameStarted = this.engine.state.round > 0 || this.engine.state.moves.length > 0;
  }

  private async persistState(): Promise<void> {
    await this.ctx.storage.put("gameState", this.engine.toJSON());
  }

  private getAllSockets(): WebSocket[] {
    const sockets: WebSocket[] = [];
    if (this.playerBlack) sockets.push(this.playerBlack);
    if (this.playerWhite) sockets.push(this.playerWhite);
    sockets.push(...this.observers);
    return sockets;
  }

  private broadcast(msg: WsMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.getAllSockets()) {
      try { ws.send(data); } catch { /* dead socket */ }
    }
  }

  private sendRoomInfo(ws: WebSocket): void {
    const payload: RoomInfoPayload = {
      players: {
        black: this.playerBlack !== null,
        white: this.playerWhite !== null,
      },
      state: this.engine.toJSON(),
    };
    ws.send(JSON.stringify({ type: MsgType.ROOM_INFO, payload }));
  }

  private broadcastState(lastMove?: { x: number; y: number; z: number }): void {
    const payload: StatePayload = {
      board: Array.from(this.engine.state.board),
      currentPlayer: this.engine.state.currentPlayer,
      round: this.engine.state.round,
      stonesPlacedThisTurn: this.engine.state.stonesPlacedThisTurn,
      winner: this.engine.state.winner,
      lastMove,
    };
    this.broadcast({ type: MsgType.STATE, payload });
  }

  private startTurnTimer(): void {
    this.clearTurnTimer();
    this.turnStartTime = Date.now();
    this.broadcastTimer();
    this.turnTimer = setTimeout(() => this.handleTimeout(), TURN_TIMEOUT_MS);
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  private broadcastTimer(): void {
    const payload: TimerPayload = {
      currentPlayer: this.engine.state.currentPlayer,
      remainingMs: TURN_TIMEOUT_MS,
      turnStartTime: this.turnStartTime,
    };
    this.broadcast({ type: MsgType.TIMER, payload });
  }

  private async handleTimeout(): Promise<void> {
    if (this.engine.state.winner !== Stone.EMPTY) return;
    const loser = this.engine.state.currentPlayer;
    const winner = loser === Player.BLACK ? Player.WHITE : Player.BLACK;
    this.engine.state.winner = winner;
    await this.persistState();
    this.broadcastState();
    this.broadcast({ type: MsgType.GAME_OVER, payload: { winner, reason: "timeout", loser } });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ensureEngine();

    let msg: WsMessage;
    try {
      const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: MsgType.ERROR, payload: "Invalid JSON" }));
      return;
    }

    switch (msg.type) {
      case MsgType.JOIN:
        this.handleJoin(ws);
        break;
      case MsgType.MOVE:
        await this.handleMove(ws, msg.payload as MovePayload);
        break;
      case MsgType.READY:
        this.handleReady(ws);
        break;
      case MsgType.RESET_REQUEST:
        this.handleResetRequest(ws);
        break;
      case MsgType.RESET_CONFIRM:
        this.handleResetConfirm(ws);
        break;
      default:
        ws.send(JSON.stringify({ type: MsgType.ERROR, payload: `Unknown type: ${msg.type}` }));
    }
  }

  // ─── Join & Ready ───

  private handleJoin(ws: WebSocket): void {
    // Reconnection
    const existing = ws.deserializeAttachment() as PlayerMeta | null;
    if (existing) {
      this.sendRoomInfo(ws);
      if (this.gameStarted) this.broadcastTimer();
      return;
    }

    // Assign slot
    if (!this.playerBlack) {
      this.playerBlack = ws;
    } else if (!this.playerWhite) {
      this.playerWhite = ws;
    } else {
      this.observers.add(ws);
      this.sendRoomInfo(ws);
      return;
    }

    // If both players are in, notify them to get ready
    if (this.playerBlack && this.playerWhite && !this.gameStarted) {
      this.broadcast({ type: MsgType.GAME_START, payload: { message: "both_ready" } });
      for (const s of this.getAllSockets()) {
        this.sendRoomInfo(s);
      }
    } else {
      this.sendRoomInfo(ws);
    }
  }

  private handleReady(ws: WebSocket): void {
    this.readyPlayers.add(ws);

    // Check if both players are ready
    const bothReady = this.playerBlack && this.playerWhite
      && this.readyPlayers.has(this.playerBlack)
      && this.readyPlayers.has(this.playerWhite);

    if (bothReady && !this.gameStarted) {
      this.gameStarted = true;
      this.readyPlayers.clear();
      this.randomizeAndStart();
    }
  }

  private randomizeAndStart(): void {
    let blackWs: WebSocket, whiteWs: WebSocket;
    if (Math.random() < 0.5) {
      blackWs = this.playerBlack!;
      whiteWs = this.playerWhite!;
    } else {
      blackWs = this.playerWhite!;
      whiteWs = this.playerBlack!;
    }

    this.playerBlack = blackWs;
    this.playerWhite = whiteWs;

    blackWs.serializeAttachment({ color: Player.BLACK } as PlayerMeta);
    whiteWs.serializeAttachment({ color: Player.WHITE } as PlayerMeta);

    blackWs.send(JSON.stringify({
      type: MsgType.PLAYER_ASSIGNED,
      payload: { color: Player.BLACK } as PlayerAssignedPayload,
    }));
    whiteWs.send(JSON.stringify({
      type: MsgType.PLAYER_ASSIGNED,
      payload: { color: Player.WHITE } as PlayerAssignedPayload,
    }));

    for (const s of this.getAllSockets()) {
      this.sendRoomInfo(s);
    }

    this.startTurnTimer();
  }

  // ─── Move ───

  private async handleMove(ws: WebSocket, payload: MovePayload): Promise<void> {
    if (!payload || typeof payload.x !== "number") {
      ws.send(JSON.stringify({ type: MsgType.ERROR, payload: "Invalid move payload" }));
      return;
    }

    const meta = ws.deserializeAttachment() as PlayerMeta | null;
    if (!meta) {
      ws.send(JSON.stringify({ type: MsgType.ERROR, payload: "You are an observer" }));
      return;
    }

    if (this.engine.state.winner !== Stone.EMPTY) {
      ws.send(JSON.stringify({ type: MsgType.ERROR, payload: "Game is over" }));
      return;
    }

    if (meta.color !== this.engine.state.currentPlayer) {
      ws.send(JSON.stringify({ type: MsgType.ERROR, payload: "Not your turn" }));
      return;
    }

    const ok = this.engine.placeStone(payload.x, payload.y, payload.z);
    if (!ok) {
      ws.send(JSON.stringify({ type: MsgType.ERROR, payload: "Illegal move" }));
      return;
    }

    await this.persistState();
    this.broadcastState({ x: payload.x, y: payload.y, z: payload.z });

    if (this.engine.state.winner !== Stone.EMPTY) {
      this.clearTurnTimer();
      this.broadcast({ type: MsgType.GAME_OVER, payload: { winner: this.engine.state.winner } });
    } else {
      this.startTurnTimer();
    }
  }

  // ─── Reset ───

  private handleResetRequest(ws: WebSocket): void {
    const meta = ws.deserializeAttachment() as PlayerMeta | null;
    if (!meta) return;

    // If game is over, reset directly without opponent confirmation
    if (this.engine.state.winner !== Stone.EMPTY) {
      this.executeReset();
      return;
    }

    // Game in progress — need opponent confirmation
    this.resetConfirmations.clear();
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }

    this.resetConfirmations.add(meta.color);

    const opponent = meta.color === Player.BLACK ? this.playerWhite : this.playerBlack;
    if (opponent) {
      opponent.send(JSON.stringify({
        type: MsgType.RESET_REQUEST,
        payload: { initiator: meta.color } as ResetRequestPayload,
      }));
    }

    this.resetTimer = setTimeout(() => {
      this.resetConfirmations.clear();
      this.broadcast({ type: MsgType.RESET_ACK, payload: { success: false } });
    }, 40_000); // 40 seconds
  }

  private handleResetConfirm(ws: WebSocket): void {
    const meta = ws.deserializeAttachment() as PlayerMeta | null;
    if (!meta) return;

    this.resetConfirmations.add(meta.color);

    const hasBlack = this.resetConfirmations.has(Player.BLACK);
    const hasWhite = this.resetConfirmations.has(Player.WHITE);

    if (hasBlack && hasWhite) {
      this.executeReset();
    }
  }

  private async executeReset(): Promise<void> {
    this.clearTurnTimer();
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    this.resetConfirmations.clear();
    this.readyPlayers.clear();
    this.gameStarted = false;

    this.engine = new Connect6Engine(this.engine.config);
    await this.persistState();
    this.broadcastState();
    this.broadcast({ type: MsgType.RESET_ACK, payload: { success: true } });

    // If both players are still connected, trigger ready check again
    if (this.playerBlack && this.playerWhite) {
      this.broadcast({ type: MsgType.GAME_START, payload: { message: "both_ready" } });
    }
  }

  // ─── Disconnect ───

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.cleanupSocket(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.cleanupSocket(ws);
  }

  private cleanupSocket(ws: WebSocket): void {
    if (ws === this.playerBlack) this.playerBlack = null;
    else if (ws === this.playerWhite) this.playerWhite = null;
    else this.observers.delete(ws);

    this.readyPlayers.delete(ws);

    for (const s of this.getAllSockets()) {
      this.sendRoomInfo(s);
    }
  }
}
