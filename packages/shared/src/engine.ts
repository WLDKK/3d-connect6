import {
  BoardConfig,
  DEFAULT_BOARD_CONFIG,
  Direction,
  GameState,
  Player,
  Stone,
  Vec3,
} from "./types";

/**
 * 13 basis direction vectors in 3D space.
 * Each pair (d, -d) covers one axis of alignment.
 * We only store the 13 "positive" half-spaces and search both ways.
 */
export const DIRECTIONS: readonly Direction[] = [
  // 3 orthogonal axes
  { x: 1, y: 0, z: 0 },  // X
  { x: 0, y: 1, z: 0 },  // Y
  { x: 0, y: 0, z: 1 },  // Z
  // 6 face diagonals
  { x: 1, y: 1, z: 0 },  // XY+
  { x: 1, y: -1, z: 0 }, // XY-
  { x: 1, y: 0, z: 1 },  // XZ+
  { x: 1, y: 0, z: -1 }, // XZ-
  { x: 0, y: 1, z: 1 },  // YZ+
  { x: 0, y: 1, z: -1 }, // YZ-
  // 4 space diagonals
  { x: 1, y: 1, z: 1 },  // XYZ+++
  { x: 1, y: 1, z: -1 }, // XYZ++-
  { x: 1, y: -1, z: 1 }, // XYZ+-+
  { x: 1, y: -1, z: -1 },// XYZ+--
];

/**
 * Core Connect6 game engine — pure TypeScript, zero DOM/Node dependencies.
 * Works identically in browser and Cloudflare Worker.
 */
export class Connect6Engine {
  readonly config: BoardConfig;
  readonly state: GameState;

  constructor(config: BoardConfig = DEFAULT_BOARD_CONFIG) {
    this.config = config;
    this.state = {
      config,
      board: new Uint8Array(config.sizeX * config.sizeY * config.sizeZ),
      currentPlayer: Player.BLACK,
      round: 0,
      stonesPlacedThisTurn: 0,
      winner: Stone.EMPTY,
      moves: [],
    };
  }

  // ─── Coordinate helpers ───

  idx(x: number, y: number, z: number): number {
    return z * this.config.sizeY * this.config.sizeX + y * this.config.sizeX + x;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return (
      x >= 0 && x < this.config.sizeX &&
      y >= 0 && y < this.config.sizeY &&
      z >= 0 && z < this.config.sizeZ
    );
  }

  getStone(x: number, y: number, z: number): Stone {
    return this.state.board[this.idx(x, y, z)];
  }

  // ─── Core game logic ───

  /** Returns true if move was legal and applied */
  placeStone(x: number, y: number, z: number): boolean {
    if (this.state.winner !== Stone.EMPTY) return false;
    if (!this.inBounds(x, y, z)) return false;
    if (this.getStone(x, y, z) !== Stone.EMPTY) return false;

    // Round 0: black places exactly 1 stone
    if (this.state.round === 0) {
      if (this.state.currentPlayer !== Player.BLACK) return false;
      if (this.state.stonesPlacedThisTurn >= 1) return false;
    } else {
      // Normal rounds: each player places 2 stones
      if (this.state.stonesPlacedThisTurn >= 2) return false;
    }

    const stone = this.state.currentPlayer as unknown as Stone;
    this.state.board[this.idx(x, y, z)] = stone;
    this.state.moves.push({ x, y, z });
    this.state.stonesPlacedThisTurn++;

    // Check win
    if (this.checkWin(x, y, z)) {
      this.state.winner = this.state.currentPlayer;
      return true;
    }

    // Advance turn
    const maxStones = this.state.round === 0 ? 1 : 2;
    if (this.state.stonesPlacedThisTurn >= maxStones) {
      this.state.currentPlayer =
        this.state.currentPlayer === Player.BLACK ? Player.WHITE : Player.BLACK;
      this.state.stonesPlacedThisTurn = 0;
      this.state.round++;
    }

    return true;
  }

  // ─── Win detection: bidirectional ray traversal ───

  /**
   * Count consecutive same-color stones from (x,y,z) in one direction.
   * Stops at board boundary or different-color stone.
   * Does NOT count the origin stone itself.
   */
  private countInDirection(
    x: number, y: number, z: number,
    dir: Direction,
    color: Stone,
  ): number {
    let count = 0;
    let cx = x + dir.x;
    let cy = y + dir.y;
    let cz = z + dir.z;
    while (this.inBounds(cx, cy, cz) && this.getStone(cx, cy, cz) === color) {
      count++;
      cx += dir.x;
      cy += dir.y;
      cz += dir.z;
    }
    return count;
  }

  /**
   * Check if placing at (x,y,z) creates a winning line.
   * Algorithm: for each of the 13 basis directions, count consecutive
   * same-color stones in both the +d and -d directions from the origin.
   * Total = 1 (origin) + count(+d) + count(-d).
   * If total >= winLength, it's a win.
   * Complexity: O(13 * winLength) per move — effectively O(1).
   */
  checkWin(x: number, y: number, z: number): boolean {
    const color = this.getStone(x, y, z);
    if (color === Stone.EMPTY) return false;

    const { winLength } = this.config;

    for (const dir of DIRECTIONS) {
      // Forward direction
      const forward = this.countInDirection(x, y, z, dir, color);
      // Reverse direction (negate the vector)
      const reverse = this.countInDirection(
        x, y, z,
        { x: -dir.x, y: -dir.y, z: -dir.z },
        color,
      );
      // 1 = the origin stone itself
      const total = 1 + forward + reverse;
      if (total >= winLength) return true;
    }

    return false;
  }

  /**
   * Find the winning line that includes (x,y,z).
   * Returns the positions of all stones in the line, or empty array if no win.
   */
  findWinningLine(x: number, y: number, z: number): Vec3[] {
    const color = this.getStone(x, y, z);
    if (color === Stone.EMPTY) return [];

    const { winLength } = this.config;

    for (const dir of DIRECTIONS) {
      const forward: Vec3[] = [];
      let cx = x + dir.x, cy = y + dir.y, cz = z + dir.z;
      while (this.inBounds(cx, cy, cz) && this.getStone(cx, cy, cz) === color) {
        forward.push({ x: cx, y: cy, z: cz });
        cx += dir.x; cy += dir.y; cz += dir.z;
      }

      const reverse: Vec3[] = [];
      cx = x - dir.x; cy = y - dir.y; cz = z - dir.z;
      while (this.inBounds(cx, cy, cz) && this.getStone(cx, cy, cz) === color) {
        reverse.push({ x: cx, y: cy, z: cz });
        cx -= dir.x; cy -= dir.y; cz -= dir.z;
      }

      const total = 1 + forward.length + reverse.length;
      if (total >= winLength) {
        return [...reverse, { x, y, z }, ...forward];
      }
    }

    return [];
  }

  // ─── Query helpers ───

  /** Get all positions occupied by a given stone color */
  getStonesOf(color: Stone): Vec3[] {
    const result: Vec3[] = [];
    const { sizeX, sizeY, sizeZ } = this.config;
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
          if (this.getStone(x, y, z) === color) {
            result.push({ x, y, z });
          }
        }
      }
    }
    return result;
  }

  /** Check if the board is completely full (draw condition) */
  isBoardFull(): boolean {
    return this.state.board.every((s) => s !== Stone.EMPTY);
  }

  /** Get all legal move positions */
  getLegalMoves(): Vec3[] {
    if (this.state.winner !== Stone.EMPTY) return [];
    const result: Vec3[] = [];
    const { sizeX, sizeY, sizeZ } = this.config;
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
          if (this.getStone(x, y, z) === Stone.EMPTY) {
            result.push({ x, y, z });
          }
        }
      }
    }
    return result;
  }

  // ─── Snapshot serialization (for WebSocket transport & DO persistence) ───

  /** Serialize to a plain JSON-safe object */
  toJSON(): SerializedState {
    return {
      config: { ...this.config },
      board: Array.from(this.state.board),
      currentPlayer: this.state.currentPlayer,
      round: this.state.round,
      stonesPlacedThisTurn: this.state.stonesPlacedThisTurn,
      winner: this.state.winner,
      moves: this.state.moves.map((m) => ({ ...m })),
    };
  }

  /** Restore from a serialized snapshot in O(1) */
  static fromJSON(data: SerializedState): Connect6Engine {
    const engine = new Connect6Engine(data.config);
    engine.state.board.set(data.board);
    engine.state.currentPlayer = data.currentPlayer;
    engine.state.round = data.round;
    engine.state.stonesPlacedThisTurn = data.stonesPlacedThisTurn;
    engine.state.winner = data.winner;
    engine.state.moves = data.moves.map((m) => ({ ...m }));
    return engine;
  }
}

/** JSON-serializable snapshot of the game state */
export interface SerializedState {
  config: BoardConfig;
  board: number[];
  currentPlayer: Player;
  round: number;
  stonesPlacedThisTurn: number;
  winner: Stone.EMPTY | Player;
  moves: Vec3[];
}
