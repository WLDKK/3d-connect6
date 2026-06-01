import { BoardConfig, Player, Stone, Vec3, Direction, AiRequestPayload, AiResponsePayload } from "./types";
import { AiMemory } from "./ai-memory";

const DIRECTIONS: readonly Direction[] = [
  { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 },
  { x: 1, y: 1, z: 0 }, { x: 1, y: -1, z: 0 },
  { x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: -1 },
  { x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: -1 },
  { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: -1 },
  { x: 1, y: -1, z: 1 }, { x: 1, y: -1, z: -1 },
];

function inBounds(x: number, y: number, z: number, c: BoardConfig): boolean {
  return x >= 0 && x < c.sizeX && y >= 0 && y < c.sizeY && z >= 0 && z < c.sizeZ;
}

function getStone(b: number[], x: number, y: number, z: number, c: BoardConfig): Stone {
  return b[z * c.sizeY * c.sizeX + y * c.sizeX + x] as Stone;
}

function setStone(b: number[], x: number, y: number, z: number, c: BoardConfig, s: Stone): void {
  b[z * c.sizeY * c.sizeX + y * c.sizeX + x] = s;
}

// ─── Line analysis ───

interface LineInfo {
  count: number;    // consecutive same-color stones
  openEnds: number; // 0, 1, or 2 open ends
}

/**
 * Analyze a line through (x,y,z) in direction `dir` for `color`.
 * Returns the count of consecutive stones and how many ends are open.
 */
function analyzeLine(
  b: number[], c: BoardConfig,
  x: number, y: number, z: number,
  dir: Direction, color: Stone,
): LineInfo {
  // Count forward
  let forward = 0;
  let fx = x + dir.x, fy = y + dir.y, fz = z + dir.z;
  while (inBounds(fx, fy, fz, c) && getStone(b, fx, fy, fz, c) === color) {
    forward++;
    fx += dir.x; fy += dir.y; fz += dir.z;
  }
  const forwardOpen = inBounds(fx, fy, fz, c) && getStone(b, fx, fy, fz, c) === Stone.EMPTY;

  // Count backward
  let backward = 0;
  const negDir = { x: -dir.x, y: -dir.y, z: -dir.z };
  let bx = x + negDir.x, by = y + negDir.y, bz = z + negDir.z;
  while (inBounds(bx, by, bz, c) && getStone(b, bx, by, bz, c) === color) {
    backward++;
    bx += negDir.x; by += negDir.y; bz += negDir.z;
  }
  const backwardOpen = inBounds(bx, by, bz, c) && getStone(b, bx, by, bz, c) === Stone.EMPTY;

  const count = 1 + forward + backward; // include origin
  const openEnds = (forwardOpen ? 1 : 0) + (backwardOpen ? 1 : 0);

  return { count, openEnds };
}

/**
 * Score a line pattern. Higher = more dangerous/valuable.
 * Open lines are exponentially more valuable than closed ones.
 */
function lineScore(count: number, openEnds: number, winLength: number): number {
  if (count >= winLength) return 100000; // WIN
  if (openEnds === 0) return 0; // closed = dead

  // Open-N scores (exponential growth)
  const scores: Record<number, number[]> = {
    // [open-1, open-2] scores for each count
    1: [1, 2],        // 1 stone: barely matters
    2: [5, 12],       // 2 stones: building
    3: [20, 60],      // 3 stones: getting dangerous
    4: [100, 500],    // 4 stones: very dangerous
    5: [1000, 10000], // 5 stones: one move from winning
  };

  const row = scores[Math.min(count, 5)];
  if (!row) return count * 100;
  return openEnds === 2 ? row[1] : row[0];
}

// ─── Board evaluation ───

/**
 * Evaluate the entire board position for `color`.
 * Sums up line scores in all 13 directions.
 */
function evaluateBoard(b: number[], c: BoardConfig, color: Stone): number {
  let total = 0;
  const seen = new Set<string>();

  for (let z = 0; z < c.sizeZ; z++) {
    for (let y = 0; y < c.sizeY; y++) {
      for (let x = 0; x < c.sizeX; x++) {
        if (getStone(b, x, y, z, c) !== color) continue;

        for (const dir of DIRECTIONS) {
          // Only count each line once (from its starting cell)
          const sx = x - dir.x, sy = y - dir.y, sz = z - dir.z;
          if (inBounds(sx, sy, sz, c) && getStone(b, sx, sy, sz, c) === color) continue;

          const key = `${x},${y},${z},${dir.x},${dir.y},${dir.z}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const info = analyzeLine(b, c, x, y, z, dir, color);
          total += lineScore(info.count, info.openEnds, c.winLength);
        }
      }
    }
  }

  return total;
}

/**
 * Evaluate a single empty cell: how much value does placing `color` here add?
 * This is the delta evaluation — much faster than full board eval.
 */
function evaluateMove(
  b: number[], c: BoardConfig,
  x: number, y: number, z: number,
  color: Stone, oppColor: Stone,
): number {
  let score = 0;

  for (const dir of DIRECTIONS) {
    const info = analyzeLine(b, c, x, y, z, dir, color);
    const infoOpp = analyzeLine(b, c, x, y, z, dir, oppColor);

    // Offensive value: what chains does this stone create/extend?
    score += lineScore(info.count, info.openEnds, c.winLength) * 1.0;

    // Defensive value: what opponent chains does this stone block?
    score += lineScore(infoOpp.count, infoOpp.openEnds, c.winLength) * 1.05;
  }

  // Center bonus: cells closer to center participate in more directions
  const cx = (c.sizeX - 1) / 2, cy = (c.sizeY - 1) / 2, cz = (c.sizeZ - 1) / 2;
  const dist = Math.abs(x - cx) / c.sizeX + Math.abs(y - cy) / c.sizeY + Math.abs(z - cz) / c.sizeZ;
  score += (1 - dist) * 3;

  return score;
}

// ─── Candidate generation ───

/**
 * Get all empty cells adjacent to existing stones (within 2 cells).
 * This dramatically reduces the search space from 1000 to ~50-100.
 */
function getCandidates(b: number[], c: BoardConfig): Vec3[] {
  const candidates: Vec3[] = [];
  const seen = new Set<number>();
  const RADIUS = 2;

  for (let z = 0; z < c.sizeZ; z++) {
    for (let y = 0; y < c.sizeY; y++) {
      for (let x = 0; x < c.sizeX; x++) {
        if (getStone(b, x, y, z, c) === Stone.EMPTY) continue;

        // For each stone, add empty neighbors within radius
        for (let dz = -RADIUS; dz <= RADIUS; dz++) {
          for (let dy = -RADIUS; dy <= RADIUS; dy++) {
            for (let dx = -RADIUS; dx <= RADIUS; dx++) {
              if (dx === 0 && dy === 0 && dz === 0) continue;
              const nx = x + dx, ny = y + dy, nz = z + dz;
              if (!inBounds(nx, ny, nz, c)) continue;
              if (getStone(b, nx, ny, nz, c) !== Stone.EMPTY) continue;

              const idx = nz * c.sizeY * c.sizeX + ny * c.sizeX + nx;
              if (seen.has(idx)) continue;
              seen.add(idx);
              candidates.push({ x: nx, y: ny, z: nz });
            }
          }
        }
      }
    }
  }

  // If board is empty, return center area
  if (candidates.length === 0) {
    const cx = Math.floor(c.sizeX / 2);
    const cy = Math.floor(c.sizeY / 2);
    const cz = Math.floor(c.sizeZ / 2);
    candidates.push({ x: cx, y: cy, z: cz });
  }

  return candidates;
}

// ─── Main AI entry points ───

export function computeAiMove(req: AiRequestPayload): AiResponsePayload {
  const { board, config, aiColor, currentPlayer, stonesToPlace } = req;
  if (currentPlayer !== aiColor) return { moves: [] };

  const aiStone = aiColor as unknown as Stone;
  const oppStone = (aiColor === Player.BLACK ? Player.WHITE : Player.BLACK) as unknown as Stone;
  const moves: Vec3[] = [];
  const workingBoard = [...board];

  for (let m = 0; m < stonesToPlace; m++) {
    const move = pickBestMoveAdvanced(workingBoard, config, aiStone, oppStone);
    if (!move) break;
    moves.push(move);
    setStone(workingBoard, move.x, move.y, move.z, config, aiStone);
  }

  return { moves };
}

export function computeAiMoveWithMemory(
  req: AiRequestPayload, memory: AiMemory,
): AiResponsePayload {
  const { board, config, aiColor, currentPlayer, stonesToPlace } = req;
  if (currentPlayer !== aiColor) return { moves: [] };

  const aiStone = aiColor as unknown as Stone;
  const oppStone = (aiColor === Player.BLACK ? Player.WHITE : Player.BLACK) as unknown as Stone;
  const moves: Vec3[] = [];
  const workingBoard = [...board];

  for (let m = 0; m < stonesToPlace; m++) {
    const move = pickBestMoveAdvanced(workingBoard, config, aiStone, oppStone, memory);
    if (!move) break;
    moves.push(move);
    setStone(workingBoard, move.x, move.y, move.z, config, aiStone);
  }

  return { moves };
}

/**
 * Advanced move picker with:
 * 1. Delta evaluation (fast per-cell scoring)
 * 2. Threat-based prioritization (win > block > build)
 * 3. 1-ply lookahead (check if opponent can win after our move)
 * 4. Memory bonus
 */
function pickBestMoveAdvanced(
  b: number[], c: BoardConfig,
  aiStone: Stone, oppStone: Stone,
  memory?: AiMemory,
): Vec3 | null {
  const candidates = getCandidates(b, c);
  if (candidates.length === 0) return null;

  // Phase 1: Score all candidates
  type ScoredMove = { pos: Vec3; score: number; aiScore: number; oppScore: number };
  const scored: ScoredMove[] = [];

  for (const pos of candidates) {
    const aiScore = evaluateMove(b, c, pos.x, pos.y, pos.z, aiStone, oppStone);
    const oppScore = evaluateMove(b, c, pos.x, pos.y, pos.z, oppStone, aiStone);
    let score = aiScore + oppScore * 1.05; // slight defensive weight

    // Memory bonus
    if (memory) {
      score += memory.query(b, c, pos.x, pos.y, pos.z) * 0.5;
    }

    scored.push({ pos, score, aiScore, oppScore });
  }

  // Phase 2: Check for immediate wins
  for (const s of scored) {
    if (s.aiScore >= 100000) return s.pos; // Can win right now
  }

  // Phase 3: Block opponent's immediate wins
  const oppWins = scored.filter(s => s.oppScore >= 100000);
  if (oppWins.length > 0) {
    // If opponent has multiple winning moves, we can't block all — pick best offensive
    if (oppWins.length > 1) {
      // Try to create our own winning threat instead
      scored.sort((a, b) => b.aiScore - a.aiScore);
      return scored[0].pos;
    }
    return oppWins[0].pos; // Block the one winning move
  }

  // Phase 4: 1-ply lookahead — for top candidates, check if opponent can win after
  scored.sort((a, b) => b.score - a.score);
  const topN = scored.slice(0, Math.min(10, scored.length));

  let bestMove = topN[0].pos;
  let bestEval = -Infinity;

  for (const candidate of topN) {
    // Simulate our move
    const simBoard = [...b];
    setStone(simBoard, candidate.pos.x, candidate.pos.y, candidate.pos.z, c, aiStone);

    // Check if opponent can win next
    const oppCandidates = getCandidates(simBoard, c);
    let oppBestScore = 0;
    for (const oc of oppCandidates) {
      const os = evaluateMove(simBoard, c, oc.x, oc.y, oc.z, oppStone, aiStone);
      if (os > oppBestScore) oppBestScore = os;
    }

    // Evaluate our position after this move
    const ourScore = evaluateBoard(simBoard, c, aiStone) - evaluateBoard(simBoard, c, oppStone);

    // Penalize moves that let opponent win
    const eval_ = oppBestScore >= 100000 ? ourScore - 50000 : ourScore + candidate.score;

    if (eval_ > bestEval) {
      bestEval = eval_;
      bestMove = candidate.pos;
    }
  }

  return bestMove;
}

// Keep the old scoreCell export for backward compatibility
export function scoreCell(
  board: number[], config: BoardConfig,
  x: number, y: number, z: number,
  color: Stone,
): number {
  let best = 0;
  for (const dir of DIRECTIONS) {
    const info = analyzeLine(board, config, x, y, z, dir, color);
    const s = lineScore(info.count, info.openEnds, config.winLength);
    if (s > best) best = s;
  }
  return best;
}
