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
} from "@connect6/shared";

interface PlayerMeta {
  color: Player.BLACK | Player.WHITE;
}

interface TimerPayload {
  currentPlayer: Player;
  remainingMs: number;
  turnStartTime: number;
}

const TURN_TIMEOUT_MS = 90_000; // 90 seconds per move

export class GameRoom extends DurableObject {
  private engine!: Connect6Engine;
  private playerBlack: WebSocket | null = null;
  private playerWhite: WebSocket | null = null;
  private observers: Set<WebSocket> = new Set();
  private turnStartTime: number = 0;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (stored) {
      this.engine = Connect6Engine.fromJSON(stored);
    } else {
      this.engine = new Connect6Engine();
    }
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

  /** Start the 90-second turn timer */
  private startTurnTimer(): void {
    this.clearTurnTimer();
    this.turnStartTime = Date.now();

    // Broadcast timer state to all clients
    this.broadcastTimer();

    // Set timeout for auto-forfeit
    this.turnTimer = setTimeout(() => {
      this.handleTimeout();
    }, TURN_TIMEOUT_MS);
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
    this.broadcast({ type: "timer" as MsgType, payload });
  }

  /** Handle turn timeout — the current player loses */
  private handleTimeout(): void {
    if (this.engine.state.winner !== Stone.EMPTY) return;

    // The current player forfeits
    const loser = this.engine.state.currentPlayer;
    const winner = loser === Player.BLACK ? Player.WHITE : Player.BLACK;
    this.engine.state.winner = winner;

    this.persistState();
    this.broadcastState();
    this.broadcast({
      type: MsgType.GAME_OVER,
      payload: { winner, reason: "timeout", loser },
    });
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
      case "get_timer" as MsgType:
        // Client requesting current timer state
        this.broadcastTimer();
        break;
      default:
        ws.send(JSON.stringify({ type: MsgType.ERROR, payload: `Unknown type: ${msg.type}` }));
    }
  }

  private handleJoin(ws: WebSocket): void {
    // Reconnection — already has a color assigned
    const existing = ws.deserializeAttachment() as PlayerMeta | null;
    if (existing) {
      this.sendRoomInfo(ws);
      this.broadcastTimer();
      return;
    }

    // Assign player color
    let color: Player.BLACK | Player.WHITE;
    if (!this.playerBlack) {
      this.playerBlack = ws;
      color = Player.BLACK;
    } else if (!this.playerWhite) {
      this.playerWhite = ws;
      color = Player.WHITE;
    } else {
      this.observers.add(ws);
      this.sendRoomInfo(ws);
      return;
    }

    ws.serializeAttachment({ color } as PlayerMeta);

    // Send color assignment to this player
    const assignPayload: PlayerAssignedPayload = { color };
    ws.send(JSON.stringify({ type: MsgType.PLAYER_ASSIGNED, payload: assignPayload }));

    // Broadcast room info to ALL clients
    for (const s of this.getAllSockets()) {
      this.sendRoomInfo(s);
    }

    // If both players are present and game hasn't started, randomize and start
    if (this.playerBlack && this.playerWhite && this.engine.state.round === 0
      && this.engine.state.moves.length === 0) {
      this.randomizeAndStart();
    }
  }

  /** Randomly assign colors when both players are in, then start the game */
  private randomizeAndStart(): void {
    // 50/50 chance to swap colors
    if (Math.random() < 0.5) {
      // Swap: current "black" becomes white, current "white" becomes black
      const temp = this.playerBlack;
      this.playerBlack = this.playerWhite;
      this.playerWhite = temp;

      // Update serialized attachments
      if (this.playerBlack) {
        this.playerBlack.serializeAttachment({ color: Player.BLACK } as PlayerMeta);
      }
      if (this.playerWhite) {
        this.playerWhite.serializeAttachment({ color: Player.WHITE } as PlayerMeta);
      }

      // Re-notify both players of their new colors
      if (this.playerBlack) {
        this.playerBlack.send(JSON.stringify({
          type: MsgType.PLAYER_ASSIGNED,
          payload: { color: Player.BLACK } as PlayerAssignedPayload,
        }));
      }
      if (this.playerWhite) {
        this.playerWhite.send(JSON.stringify({
          type: MsgType.PLAYER_ASSIGNED,
          payload: { color: Player.WHITE } as PlayerAssignedPayload,
        }));
      }
    }

    // Send updated room info to all
    for (const s of this.getAllSockets()) {
      this.sendRoomInfo(s);
    }

    // Start the turn timer (Black goes first)
    this.startTurnTimer();
  }

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
      this.broadcast({
        type: MsgType.GAME_OVER,
        payload: { winner: this.engine.state.winner },
      });
    } else {
      // Start timer for next player's turn
      this.startTurnTimer();
    }
  }

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

    // Notify remaining players
    for (const s of this.getAllSockets()) {
      this.sendRoomInfo(s);
    }
  }
}
