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

/** Player metadata attached to each WebSocket via serializeAttachment */
interface PlayerMeta {
  color: Player.BLACK | Player.WHITE;
}

/**
 * GameRoom Durable Object — authoritative game state for one room.
 * Uses WebSocket Hibernation API for cost-efficient idle connections.
 */
export class GameRoom extends DurableObject {
  private engine!: Connect6Engine;
  private playerBlack: WebSocket | null = null;
  private playerWhite: WebSocket | null = null;
  private observers: Set<WebSocket> = new Set();

  async fetch(request: Request): Promise<Response> {
    await this.ensureEngine();

    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    return this.handleInfoRequest();
  }

  private handleInfoRequest(): Response {
    const state = this.engine.toJSON();
    return Response.json({
      players: {
        black: this.playerBlack !== null,
        white: this.playerWhite !== null,
      },
      state,
    });
  }

  /** Load or create engine from DO storage */
  private async ensureEngine(): Promise<void> {
    if (this.engine) return;
    const stored = await this.ctx.storage.get<SerializedState>("gameState");
    if (stored) {
      this.engine = Connect6Engine.fromJSON(stored);
    } else {
      this.engine = new Connect6Engine();
    }
  }

  /** Persist current game state to DO storage */
  private async persistState(): Promise<void> {
    await this.ctx.storage.put("gameState", this.engine.toJSON());
  }

  /** Broadcast a message to all connected WebSockets */
  private broadcast(msg: WsMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.getAllSockets()) {
      try { ws.send(data); } catch { /* dead socket */ }
    }
  }

  private getAllSockets(): WebSocket[] {
    const sockets: WebSocket[] = [];
    if (this.playerBlack) sockets.push(this.playerBlack);
    if (this.playerWhite) sockets.push(this.playerWhite);
    sockets.push(...this.observers);
    return sockets;
  }

  /** Send full room info snapshot to one client */
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

  /** Broadcast current game state to all clients */
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
      default:
        ws.send(JSON.stringify({ type: MsgType.ERROR, payload: `Unknown type: ${msg.type}` }));
    }
  }

  private handleJoin(ws: WebSocket): void {
    // Reconnection — already has a color assigned
    const existing = ws.deserializeAttachment() as PlayerMeta | null;
    if (existing) {
      this.sendRoomInfo(ws);
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

    const assignPayload: PlayerAssignedPayload = { color };
    ws.send(JSON.stringify({ type: MsgType.PLAYER_ASSIGNED, payload: assignPayload }));
    this.sendRoomInfo(ws);
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
      this.broadcast({
        type: MsgType.GAME_OVER,
        payload: { winner: this.engine.state.winner },
      });
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
  }
}
