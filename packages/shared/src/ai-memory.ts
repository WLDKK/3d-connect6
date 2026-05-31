import { BoardConfig, Player, Stone, Vec3 } from "./types";

/**
 * AI Self-Learning Memory System
 *
 * Stores game outcomes and correlates positions with winning moves.
 * When the AI encounters similar positions, it boosts the score of
 * moves that historically led to victories.
 *
 * Memory format: Map<positionKey, { move, wins, games }>
 * - positionKey: hash of local neighborhood around each empty cell
 * - move: the coordinate that was played
 * - wins: number of times this move led to a win
 * - games: total games where this position was encountered
 */

/** Compact board hash: hash the 3x3x3 neighborhood around a cell */
export function hashNeighborhood(
  board: number[], config: BoardConfig,
  cx: number, cy: number, cz: number,
): string {
  const { sizeX, sizeY, sizeZ } = config;
  let hash = 0;
  let bit = 0;

  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz;
        let val = 0; // 0 = out of bounds or empty
        if (nx >= 0 && nx < sizeX && ny >= 0 && ny < sizeY && nz >= 0 && nz < sizeZ) {
          val = board[nz * sizeY * sizeX + ny * sizeX + nx];
        }
        // 2 bits per cell: 0=empty, 1=black, 2=white
        hash = (hash * 3 + val) | 0;
        bit++;
      }
    }
  }

  // Also include the position itself for uniqueness
  hash = (hash * 31 + cx * 7 + cy * 11 + cz * 13) | 0;
  return hash.toString(36);
}

/** Memory entry for a position-move pair */
interface MemoryEntry {
  wins: number;
  games: number;
}

/** Game move record for learning */
export interface GameRecord {
  moves: Vec3[];
  winner: Player | 0;
}

/** Serializable memory store */
export type MemoryData = Record<string, MemoryEntry>;

/**
 * Core memory engine. Stores and queries position-move statistics.
 */
export class AiMemory {
  private data: Map<string, MemoryEntry> = new Map();

  constructor(data?: MemoryData) {
    if (data) {
      for (const [key, entry] of Object.entries(data)) {
        this.data.set(key, entry);
      }
    }
  }

  /** Query: get win-rate bonus for a move at (x,y,z) */
  query(board: number[], config: BoardConfig, x: number, y: number, z: number): number {
    const key = hashNeighborhood(board, config, x, y, z);
    const entry = this.data.get(key);
    if (!entry || entry.games < 3) return 0; // Need minimum games for significance

    const winRate = entry.wins / entry.games;
    // Scale bonus: 0 to 5 points based on historical win rate
    return winRate * 5 * Math.min(entry.games / 10, 1); // More games = more confidence
  }

  /** Learn from a completed game */
  learn(record: GameRecord, config: BoardConfig): void {
    if (record.winner === 0) return; // Draw, nothing to learn

    const board = new Array(config.sizeX * config.sizeY * config.sizeZ).fill(0);
    const winnerColor = record.winner;

    // Replay the game and record which moves were made by the winner
    for (let i = 0; i < record.moves.length; i++) {
      const move = record.moves[i];
      // Connect6: move 0 = Black, moves 1-2 = White, moves 3-4 = Black, ...
      const isBlackTurn = i === 0 || (Math.floor((i - 1) / 2) % 2 === 1);
      const color = isBlackTurn ? Stone.BLACK : Stone.WHITE;

      const idx = move.z * config.sizeY * config.sizeX + move.y * config.sizeX + move.x;
      board[idx] = color;

      // Only learn from the winner's moves
      if (color === (winnerColor as unknown as Stone)) {
        const key = hashNeighborhood(board, config, move.x, move.y, move.z);
        const existing = this.data.get(key) || { wins: 0, games: 0 };
        existing.wins++;
        existing.games++;
        this.data.set(key, existing);
      } else {
        // Record that this position was encountered (but didn't win)
        const key = hashNeighborhood(board, config, move.x, move.y, move.z);
        const existing = this.data.get(key) || { wins: 0, games: 0 };
        existing.games++;
        this.data.set(key, existing);
      }
    }
  }

  /** Export to serializable format */
  toJSON(): MemoryData {
    const result: MemoryData = {};
    for (const [key, entry] of this.data) {
      result[key] = entry;
    }
    return result;
  }

  /** Get stats */
  get stats() {
    return {
      entries: this.data.size,
      totalGames: [...this.data.values()].reduce((s, e) => s + e.games, 0),
    };
  }
}
