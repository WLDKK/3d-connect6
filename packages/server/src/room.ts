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

interface SessionState {
  gameStarted: boolean;
  colorsAssigned: boolean;
  turnStartTime: number;
  turnDeadline: number | null;
  resetDeadline: number | null;
  resetConfirmations: Player[];
  readyPlayers: Player[];
}

interface TimerPayload {
  currentPlayer: Player;
  remainingMs: number;
  turnStartTime: number;
}

const TURN_TIMEOUT_MS = 90_000; // 90 seconds

export class GameRoom extends DurableObject {
  private engine!: Connect6Engine;
  private playerBlack: WebSocket | null = null;
  private playerWhite: WebSocket | null = null;
  private observers: Set<WebSocket> = new Set();
  private turnStartTime: number = 0;
  private turnDeadline: number | null = null;
  private resetConfirmations: Set<Player> = new Set();
  private resetDeadline: number | null = null;
  /** Provisional seats or assigned colors that clicked "ready". */
  private readyPlayers: Set<Player> = new Set();
  private gameStarted: boolean = false;
  /** First match is random; later rematches alternate colors for session fairness. */
  private colorsAssigned: boolean = false;

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
    const [stored, session] = await Promise.all([
      this.ctx.storage.get<SerializedState>("gameState"),
      this.ctx.storage.get<SessionState>("sessionState"),
    ]);
    this.engine = stored ? Connect6Engine.fromJSON(stored) : new Connect6Engine();
    this.gameStarted = session?.gameStarted
      ?? (this.engine.state.round > 0 || this.engine.state.moves.length > 0);
    this.colorsAssigned = session?.colorsAssigned ?? this.gameStarted;
    this.turnStartTime = session?.turnStartTime ?? 0;
    this.turnDeadline = session?.turnDeadline ?? null;
    this.resetDeadline = session?.resetDeadline ?? null;
    this.resetConfirmations = new Set(session?.resetConfirmations ?? []);
    this.readyPlayers = new Set(session?.readyPlayers ?? []);

    for (const socket of this.ctx.getWebSockets()) {
      const meta = socket.deserializeAttachment() as PlayerMeta | null;
      if (meta?.color === Player.BLACK && !this.playerBlack) this.playerBlack = socket;
      else if (meta?.color === Player.WHITE && !this.playerWhite) this.playerWhite = socket;
      else this.observers.add(socket);
    }

    // Seamless migration from versions that did not persist turn deadlines.
    if (this.gameStarted && this.engine.state.winner === Stone.EMPTY && !this.engine.isDraw() && !this.turnDeadline) {
      this.turnStartTime = Date.now();
      this.turnDeadline = this.turnStartTime + TURN_TIMEOUT_MS;
      await this.persistSessionAndAlarm();
    }
  }

  private async persistState(): Promise<void> {
    await this.ctx.storage.put("gameState", this.engine.toJSON());
  }

  private async persistSessionAndAlarm(): Promise<void> {
    const session: SessionState = {
      gameStarted: this.gameStarted,
      colorsAssigned: this.colorsAssigned,
      turnStartTime: this.turnStartTime,
      turnDeadline: this.turnDeadline,
      resetDeadline: this.resetDeadline,
      resetConfirmations: [...this.resetConfirmations],
      readyPlayers: [...this.readyPlayers],
    };
    await this.ctx.storage.put("sessionState", session);

    const deadlines = [this.turnDeadline, this.resetDeadline]
      .filter((deadline): deadline is number => deadline !== null);
    if (deadlines.length > 0) await this.ctx.storage.setAlarm(Math.min(...deadlines));
    else await this.ctx.storage.deleteAlarm();
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

  private async startTurnTimer(): Promise<void> {
    this.turnStartTime = Date.now();
    this.turnDeadline = this.turnStartTime + TURN_TIMEOUT_MS;
    await this.persistSessionAndAlarm();
    this.broadcastTimer();
  }

  private async clearTurnTimer(): Promise<void> {
    this.turnStartTime = 0;
    this.turnDeadline = null;
    await this.persistSessionAndAlarm();
  }

  private broadcastTimer(): void {
    const payload: TimerPayload = {
      currentPlayer: this.engine.state.currentPlayer,
      remainingMs: this.turnDeadline ? Math.max(0, this.turnDeadline - Date.now()) : 0,
      turnStartTime: this.turnStartTime,
    };
    this.broadcast({ type: MsgType.TIMER, payload });
  }

  private async handleTimeout(): Promise<void> {
    if (this.engine.state.winner !== Stone.EMPTY || this.engine.isDraw()) return;
    const loser = this.engine.state.currentPlayer;
    const winner = loser === Player.BLACK ? Player.WHITE : Player.BLACK;
    this.engine.state.winner = winner;
    await Promise.all([this.persistState(), this.clearTurnTimer()]);
    this.broadcastState();
    this.broadcast({ type: MsgType.GAME_OVER, payload: { winner, reason: "timeout", loser } });
  }

  async alarm(): Promise<void> {
    await this.ensureEngine();
    const now = Date.now();

    if (this.resetDeadline !== null && now >= this.resetDeadline) {
      this.resetDeadline = null;
      this.resetConfirmations.clear();
      this.broadcast({ type: MsgType.RESET_ACK, payload: { success: false, reason: "timeout" } });
    }

    if (this.turnDeadline !== null && now >= this.turnDeadline) {
      await this.handleTimeout();
      return;
    }

    await this.persistSessionAndAlarm();
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
        await this.handleReady(ws);
        break;
      case MsgType.RESET_REQUEST:
        await this.handleResetRequest(ws);
        break;
      case MsgType.RESET_CONFIRM:
        await this.handleResetConfirm(ws);
        break;
      case MsgType.RESET_REJECT:
        await this.handleResetReject(ws);
        break;
      default:
        ws.send(JSON.stringify({ type: MsgType.ERROR, payload: `Unknown type: ${msg.type}` }));
    }
  }

  // ─── Join & Ready ───

  private handleJoin(ws: WebSocket): void {
    // Reconnection — already has a color assigned
    const existing = ws.deserializeAttachment() as PlayerMeta | null;
    if (existing) {
      this.sendRoomInfo(ws);
      if (this.gameStarted) this.broadcastTimer();
      return;
    }

    // If game is in progress and a slot is empty, this is a reconnecting player
    if (this.gameStarted) {
      if (!this.playerBlack) {
        this.playerBlack = ws;
        ws.serializeAttachment({ color: Player.BLACK } as PlayerMeta);
        ws.send(JSON.stringify({ type: MsgType.PLAYER_ASSIGNED, payload: { color: Player.BLACK } }));
      } else if (!this.playerWhite) {
        this.playerWhite = ws;
        ws.serializeAttachment({ color: Player.WHITE } as PlayerMeta);
        ws.send(JSON.stringify({ type: MsgType.PLAYER_ASSIGNED, payload: { color: Player.WHITE } }));
      } else {
        this.observers.add(ws);
      }
      this.sendRoomInfo(ws);
      this.broadcastTimer();
      return;
    }

    // New game — assign slot
    if (!this.playerBlack) {
      this.playerBlack = ws;
      ws.serializeAttachment({ color: Player.BLACK } as PlayerMeta);
    } else if (!this.playerWhite) {
      this.playerWhite = ws;
      ws.serializeAttachment({ color: Player.WHITE } as PlayerMeta);
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

  private async handleReady(ws: WebSocket): Promise<void> {
    const meta = ws.deserializeAttachment() as PlayerMeta | null;
    if (!meta || (ws !== this.playerBlack && ws !== this.playerWhite)) return;
    this.readyPlayers.add(meta.color);

    // Check if both players are ready
    const bothReady = this.playerBlack && this.playerWhite
      && this.readyPlayers.has(Player.BLACK)
      && this.readyPlayers.has(Player.WHITE);

    if (bothReady && !this.gameStarted) {
      this.gameStarted = true;
      this.readyPlayers.clear();
      await this.randomizeAndStart();
    } else {
      await this.persistSessionAndAlarm();
    }
  }

  private async randomizeAndStart(): Promise<void> {
    let blackWs: WebSocket, whiteWs: WebSocket;
    if (this.colorsAssigned) {
      // Alternate colors on rematches so a session cannot repeatedly favor one seat.
      blackWs = this.playerWhite!;
      whiteWs = this.playerBlack!;
    } else if (crypto.getRandomValues(new Uint8Array(1))[0] < 128) {
      blackWs = this.playerBlack!;
      whiteWs = this.playerWhite!;
    } else {
      blackWs = this.playerWhite!;
      whiteWs = this.playerBlack!;
    }

    this.playerBlack = blackWs;
    this.playerWhite = whiteWs;
    this.colorsAssigned = true;

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

    await this.startTurnTimer();
  }

  // ─── Move ───

  private async handleMove(ws: WebSocket, payload: MovePayload): Promise<void> {
    if (!this.gameStarted) {
      ws.send(JSON.stringify({ type: MsgType.ERROR, payload: "Game has not started" }));
      return;
    }
    if (!payload || typeof payload.x !== "number" || typeof payload.y !== "number" || typeof payload.z !== "number") {
      ws.send(JSON.stringify({ type: MsgType.ERROR, payload: "Invalid move payload" }));
      return;
    }
    if (![payload.x, payload.y, payload.z].every(Number.isInteger)) {
      ws.send(JSON.stringify({ type: MsgType.ERROR, payload: "Invalid coordinates" }));
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

    const turnPlayer = this.engine.state.currentPlayer;
    const ok = this.engine.placeStone(payload.x, payload.y, payload.z);
    if (!ok) {
      ws.send(JSON.stringify({ type: MsgType.ERROR, payload: "Illegal move" }));
      return;
    }

    await this.persistState();
    this.broadcastState({ x: payload.x, y: payload.y, z: payload.z });

    if (this.engine.state.winner !== Stone.EMPTY) {
      await this.clearTurnTimer();
      this.broadcast({ type: MsgType.GAME_OVER, payload: { winner: this.engine.state.winner } });
    } else if (this.engine.isDraw()) {
      await this.clearTurnTimer();
      this.broadcast({ type: MsgType.GAME_OVER, payload: { winner: Stone.EMPTY, reason: "draw" } });
    } else if (this.engine.state.currentPlayer !== turnPlayer) {
      // Both stones in a normal turn share one 90-second clock.
      await this.startTurnTimer();
    }
  }

  // ─── Reset ───

  private async handleResetRequest(ws: WebSocket): Promise<void> {
    const meta = ws.deserializeAttachment() as PlayerMeta | null;
    if (!meta) return;

    // If game is over, reset directly without opponent confirmation
    if (this.engine.state.winner !== Stone.EMPTY || this.engine.isDraw()) {
      await this.executeReset();
      return;
    }

    // Game in progress — need opponent confirmation
    this.resetConfirmations.clear();
    this.resetDeadline = Date.now() + 40_000;

    this.resetConfirmations.add(meta.color);

    const opponent = meta.color === Player.BLACK ? this.playerWhite : this.playerBlack;
    if (opponent) {
      opponent.send(JSON.stringify({
        type: MsgType.RESET_REQUEST,
        payload: { initiator: meta.color } as ResetRequestPayload,
      }));
    }

    await this.persistSessionAndAlarm();
  }

  private async handleResetConfirm(ws: WebSocket): Promise<void> {
    const meta = ws.deserializeAttachment() as PlayerMeta | null;
    if (!meta) return;

    this.resetConfirmations.add(meta.color);

    const hasBlack = this.resetConfirmations.has(Player.BLACK);
    const hasWhite = this.resetConfirmations.has(Player.WHITE);

    if (hasBlack && hasWhite) {
      await this.executeReset();
    }
  }

  private async handleResetReject(ws: WebSocket): Promise<void> {
    const meta = ws.deserializeAttachment() as PlayerMeta | null;
    if (!meta || this.resetConfirmations.size === 0) return;

    this.resetDeadline = null;
    this.resetConfirmations.clear();
    await this.persistSessionAndAlarm();
    this.broadcast({ type: MsgType.RESET_ACK, payload: { success: false, reason: "rejected" } });
  }

  private async executeReset(): Promise<void> {
    this.turnStartTime = 0;
    this.turnDeadline = null;
    this.resetDeadline = null;
    this.resetConfirmations.clear();
    this.readyPlayers.clear();
    this.gameStarted = false;

    this.engine = new Connect6Engine(this.engine.config);
    await Promise.all([this.persistState(), this.persistSessionAndAlarm()]);
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

  private async cleanupSocket(ws: WebSocket): Promise<void> {
    const meta = ws.deserializeAttachment() as PlayerMeta | null;
    if (ws === this.playerBlack) this.playerBlack = null;
    else if (ws === this.playerWhite) this.playerWhite = null;
    else this.observers.delete(ws);

    if (meta) this.readyPlayers.delete(meta.color);

    // If no players remain, reset the board for the next game
    if (!this.playerBlack && !this.playerWhite) {
      this.turnStartTime = 0;
      this.turnDeadline = null;
      this.resetDeadline = null;
      this.resetConfirmations.clear();
      this.readyPlayers.clear();
      this.gameStarted = false;
      this.colorsAssigned = false;
      this.engine = new Connect6Engine(this.engine.config);
      await Promise.all([this.persistState(), this.persistSessionAndAlarm()]);
    }

    for (const s of this.getAllSockets()) {
      this.sendRoomInfo(s);
    }
  }
}
