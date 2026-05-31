import { BoardConfig, Player, Stone, Vec3, Direction, AiRequestPayload, AiResponsePayload } from "./types";
import { AiMemory } from "./ai-memory";

/**
 * 13 basis direction vectors (positive half-spaces only).
 * Search both +d and -d from each cell.
 */
const DIRECTIONS: readonly Direction[] = [
  { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 },
  { x: 1, y: 1, z: 0 }, { x: 1, y: -1, z: 0 },
  { x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: -1 },
  { x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: -1 },
  { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: -1 },
  { x: 1, y: -1, z: 1 }, { x: 1, y: -1, z: -1 },
];

function inBounds(x: number, y: number, z: number, config: BoardConfig): boolean {
  return x >= 0 && x < config.sizeX && y >= 0 && y < config.sizeY && z >= 0 && z < config.sizeZ;
}

function getStone(board: number[], x: number, y: number, z: number, config: BoardConfig): Stone {
  return board[z * config.sizeY * config.sizeX + y * config.sizeX + x] as Stone;
}

/**
 * Count consecutive stones of `color` starting from (x+dx, y+dy, z+dz)
 * in direction `dir`. Stops at boundary or different color.
 */
function countDir(
  board: number[], config: BoardConfig,
  x: number, y: number, z: number,
  dir: Direction, color: Stone,
): number {
  let count = 0;
  let cx = x + dir.x, cy = y + dir.y, cz = z + dir.z;
  while (inBounds(cx, cy, cz, config) && getStone(board, cx, cy, cz, config) === color) {
    count++;
    cx += dir.x; cy += dir.y; cz += dir.z;
  }
  return count;
}

/**
 * Score a single empty cell for a given color.
 * Returns the maximum chain length achievable through this cell in any direction.
 * Higher score = more valuable move.
 */
export function scoreCell(
  board: number[], config: BoardConfig,
  x: number, y: number, z: number,
  color: Stone,
): number {
  let best = 0;
  for (const dir of DIRECTIONS) {
    const forward = countDir(board, config, x, y, z, dir, color);
    const reverse = countDir(board, config, x, y, z, { x: -dir.x, y: -dir.y, z: -dir.z }, color);
    const total = 1 + forward + reverse; // 1 = the cell itself
    if (total > best) best = total;
  }
  return best;
}

/**
 * Dummy AI — greedy defense heuristic.
 *
 * Strategy:
 * 1. For each empty cell, compute:
 *    - `attackScore`: chain length if AI places here (offense)
 *    - `defendScore`: chain length if OPPONENT places here (threat)
 * 2. If any defendScore >= 5 (opponent about to win), block it immediately.
 * 3. If any attackScore >= 5 (AI can win), take it.
 * 4. Otherwise, pick the cell with the highest weighted score:
 *    score = attackScore * 1.0 + defendScore * 1.1  (slightly favor defense)
 * 5. If all scores are 0 (empty board or no threats), pick center-ish random.
 *
 * When placing 2 stones per turn, picks the best move first,
 * then re-evaluates the board for the second move.
 */
export function computeAiMove(req: AiRequestPayload): AiResponsePayload {
  const { board, config, aiColor, currentPlayer, stonesToPlace } = req;

  // Only compute if it's the AI's turn
  if (currentPlayer !== aiColor) {
    return { moves: [] };
  }

  const opponentColor = aiColor === Player.BLACK ? Player.WHITE : Player.BLACK;
  const moves: Vec3[] = [];
  // Work on a mutable copy so second move sees the first
  const workingBoard = [...board];

  for (let m = 0; m < stonesToPlace; m++) {
    const move = pickBestMove(workingBoard, config, aiColor as unknown as Stone, opponentColor as unknown as Stone);
    if (!move) break;
    moves.push(move);
    // Apply to working board so next evaluation accounts for it
    workingBoard[move.z * config.sizeY * config.sizeX + move.y * config.sizeX + move.x] = aiColor as unknown as Stone;
  }

  return { moves };
}

/**
 * AI move computation with memory enhancement.
 * Combines greedy evaluation with historical win-rate bonus from memory.
 */
export function computeAiMoveWithMemory(
  req: AiRequestPayload, memory: AiMemory,
): AiResponsePayload {
  const { board, config, aiColor, currentPlayer, stonesToPlace } = req;

  if (currentPlayer !== aiColor) {
    return { moves: [] };
  }

  const opponentColor = aiColor === Player.BLACK ? Player.WHITE : Player.BLACK;
  const moves: Vec3[] = [];
  const workingBoard = [...board];

  for (let m = 0; m < stonesToPlace; m++) {
    const move = pickBestMoveWithMemory(workingBoard, config, aiColor as unknown as Stone, opponentColor as unknown as Stone, memory);
    if (!move) break;
    moves.push(move);
    workingBoard[move.z * config.sizeY * config.sizeX + move.y * config.sizeX + move.x] = aiColor as unknown as Stone;
  }

  return { moves };
}

function pickBestMove(
  board: number[], config: BoardConfig,
  aiStone: Stone, opponentStone: Stone,
): Vec3 | null {
  let bestScore = -1;
  let bestMoves: Vec3[] = [];

  for (let z = 0; z < config.sizeZ; z++) {
    for (let y = 0; y < config.sizeY; y++) {
      for (let x = 0; x < config.sizeX; x++) {
        if (board[z * config.sizeY * config.sizeX + y * config.sizeX + x] !== Stone.EMPTY) continue;

        const attack = scoreCell(board, config, x, y, z, aiStone);
        const defend = scoreCell(board, config, x, y, z, opponentStone);

        // Weighted score: slightly favor defense
        const score = attack * 1.0 + defend * 1.1;

        if (score > bestScore) {
          bestScore = score;
          bestMoves = [{ x, y, z }];
        } else if (score === bestScore && score > 0) {
          bestMoves.push({ x, y, z });
        }
      }
    }
  }

  // No scored moves (empty board) — pick near center
  if (bestScore <= 0) {
    const cx = Math.floor(config.sizeX / 2);
    const cy = Math.floor(config.sizeY / 2);
    const cz = Math.floor(config.sizeZ / 2);
    // Try center, then neighbors
    const candidates = [
      { x: cx, y: cy, z: cz },
      { x: cx + 1, y: cy, z: cz },
      { x: cx, y: cy + 1, z: cz },
      { x: cx, y: cy, z: cz + 1 },
      { x: cx - 1, y: cy, z: cz },
    ];
    for (const c of candidates) {
      if (inBounds(c.x, c.y, c.z, config)
        && board[c.z * config.sizeY * config.sizeX + c.y * config.sizeX + c.x] === Stone.EMPTY) {
        return c;
      }
    }
    // Fallback: first empty cell
    for (let z = 0; z < config.sizeZ; z++) {
      for (let y = 0; y < config.sizeY; y++) {
        for (let x = 0; x < config.sizeX; x++) {
          if (board[z * config.sizeY * config.sizeX + y * config.sizeX + x] === Stone.EMPTY) {
            return { x, y, z };
          }
        }
      }
    }
    return null;
  }

  // Pick randomly among equally-scored best moves
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

/**
 * Memory-enhanced move picker.
 * Combines greedy score with historical win-rate bonus from memory.
 */
function pickBestMoveWithMemory(
  board: number[], config: BoardConfig,
  aiStone: Stone, opponentStone: Stone,
  memory: AiMemory,
): Vec3 | null {
  let bestScore = -1;
  let bestMoves: Vec3[] = [];

  for (let z = 0; z < config.sizeZ; z++) {
    for (let y = 0; y < config.sizeY; y++) {
      for (let x = 0; x < config.sizeX; x++) {
        if (board[z * config.sizeY * config.sizeX + y * config.sizeX + x] !== Stone.EMPTY) continue;

        const attack = scoreCell(board, config, x, y, z, aiStone);
        const defend = scoreCell(board, config, x, y, z, opponentStone);

        // Memory bonus: historical win rate at this position
        const memBonus = memory.query(board, config, x, y, z);

        // Combined score: greedy + memory
        const score = attack * 1.0 + defend * 1.1 + memBonus * 0.8;

        if (score > bestScore) {
          bestScore = score;
          bestMoves = [{ x, y, z }];
        } else if (score === bestScore && score > 0) {
          bestMoves.push({ x, y, z });
        }
      }
    }
  }

  if (bestScore <= 0) {
    // Same fallback as non-memory version
    const cx = Math.floor(config.sizeX / 2);
    const cy = Math.floor(config.sizeY / 2);
    const cz = Math.floor(config.sizeZ / 2);
    const candidates = [
      { x: cx, y: cy, z: cz },
      { x: cx + 1, y: cy, z: cz },
      { x: cx, y: cy + 1, z: cz },
      { x: cx, y: cy, z: cz + 1 },
      { x: cx - 1, y: cy, z: cz },
    ];
    for (const c of candidates) {
      if (c.x >= 0 && c.x < config.sizeX && c.y >= 0 && c.y < config.sizeY && c.z >= 0 && c.z < config.sizeZ
        && board[c.z * config.sizeY * config.sizeX + c.y * config.sizeX + c.x] === Stone.EMPTY) {
        return c;
      }
    }
    for (let z = 0; z < config.sizeZ; z++) {
      for (let y = 0; y < config.sizeY; y++) {
        for (let x = 0; x < config.sizeX; x++) {
          if (board[z * config.sizeY * config.sizeX + y * config.sizeX + x] === Stone.EMPTY) {
            return { x, y, z };
          }
        }
      }
    }
    return null;
  }

  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}
