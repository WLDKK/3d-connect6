import { BoardConfig, Player, Stone, Vec3, Direction, AiRequestPayload, AiResponsePayload } from "./types";
import { AiMemory } from "./ai-memory";
import { DIRECTIONS } from "./engine";

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
  count: number;
  openEnds: number;
  /** How many empty cells exist in this line's direction (potential to grow) */
  potential: number;
}

function analyzeLine(
  b: number[], c: BoardConfig,
  x: number, y: number, z: number,
  dir: Direction, color: Stone,
): LineInfo {
  let forward = 0, forwardEmpty = 0;
  let fx = x + dir.x, fy = y + dir.y, fz = z + dir.z;
  while (inBounds(fx, fy, fz, c)) {
    const s = getStone(b, fx, fy, fz, c);
    if (s === color) { forward++; fx += dir.x; fy += dir.y; fz += dir.z; }
    else if (s === Stone.EMPTY) { forwardEmpty++; break; }
    else break;
  }
  const forwardOpen = inBounds(fx, fy, fz, c) && getStone(b, fx, fy, fz, c) === Stone.EMPTY;

  let backward = 0, backwardEmpty = 0;
  const nd = { x: -dir.x, y: -dir.y, z: -dir.z };
  let bx = x + nd.x, by = y + nd.y, bz = z + nd.z;
  while (inBounds(bx, by, bz, c)) {
    const s = getStone(b, bx, by, bz, c);
    if (s === color) { backward++; bx += nd.x; by += nd.y; bz += nd.z; }
    else if (s === Stone.EMPTY) { backwardEmpty++; break; }
    else break;
  }
  const backwardOpen = inBounds(bx, by, bz, c) && getStone(b, bx, by, bz, c) === Stone.EMPTY;

  const count = 1 + forward + backward;
  const openEnds = (forwardOpen ? 1 : 0) + (backwardOpen ? 1 : 0);
  const potential = forwardEmpty + backwardEmpty;

  return { count, openEnds, potential };
}

/**
 * Core line scoring with nuanced open/half-open distinction.
 * Exponential growth for open lines makes the AI prioritize building them.
 */
function lineScore(count: number, openEnds: number, winLength: number): number {
  if (count >= winLength) return 500000;
  if (openEnds === 0) return 0;

  // [half-open, open] scores
  const table: [number, number][] = [
    [0, 0],       // 0: unused
    [2, 4],       // 1 stone
    [8, 20],      // 2 stones
    [30, 100],    // 3 stones
    [200, 1200],  // 4 stones
    [5000, 50000], // 5 stones (one move from win)
  ];

  const idx = Math.min(count, winLength - 1);
  const row = table[idx] || [count * 50, count * 100];
  return openEnds === 2 ? row[1] : row[0];
}

/**
 * Threat level scoring — for tactical decision making.
 * Returns how many moves until a line becomes a win.
 */
function threatLevel(count: number, openEnds: number, winLength: number): number {
  if (count >= winLength) return 0; // already won
  if (openEnds === 0) return 999; // dead
  const gap = winLength - count;
  if (openEnds === 2) return gap; // need `gap` stones (can use both ends)
  return gap + 1; // half-open needs one more
}

// ─── Board evaluation ───

function evaluateBoard(b: number[], c: BoardConfig, color: Stone): number {
  let total = 0;
  const seen = new Set<string>();

  for (let z = 0; z < c.sizeZ; z++) {
    for (let y = 0; y < c.sizeY; y++) {
      for (let x = 0; x < c.sizeX; x++) {
        if (getStone(b, x, y, z, c) !== color) continue;
        for (const dir of DIRECTIONS) {
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
 * Evaluate a single empty cell for `color`.
 * Returns a detailed score considering offensive and defensive value.
 */
function evaluateMove(
  b: number[], c: BoardConfig,
  x: number, y: number, z: number,
  color: Stone, oppColor: Stone,
): { attack: number; defend: number; total: number } {
  let attack = 0, defend = 0;

  for (const dir of DIRECTIONS) {
    const info = analyzeLine(b, c, x, y, z, dir, color);
    const infoOpp = analyzeLine(b, c, x, y, z, dir, oppColor);

    attack += lineScore(info.count, info.openEnds, c.winLength);
    defend += lineScore(infoOpp.count, infoOpp.openEnds, c.winLength);
  }

  // Center bonus
  const cx = (c.sizeX - 1) / 2, cy = (c.sizeY - 1) / 2, cz = (c.sizeZ - 1) / 2;
  const dist = Math.abs(x - cx) / c.sizeX + Math.abs(y - cy) / c.sizeY + Math.abs(z - cz) / c.sizeZ;
  const centerBonus = (1 - dist) * 3;

  // Defense weight increases when threats are more urgent
  const defendWeight = defend >= 5000 ? 1.5 : defend >= 1200 ? 1.3 : 1.1;

  return { attack, defend, total: attack + defend * defendWeight + centerBonus };
}

// ─── Threat counting ───

interface ThreatInfo {
  /** Number of cells where this color can win immediately */
  winMoves: number;
  /** Number of open-5 (one move from win) */
  open5: number;
  /** Number of open-4 (forcing, opponent must respond) */
  open4: number;
  /** Number of open-3 (building toward threat) */
  open3: number;
  /** Can this color create a double threat (two open-4s) in one move? */
  doubleThreat: boolean;
  /** Best double-threat move position */
  doubleThreatPos: Vec3 | null;
}

function countThreats(b: number[], c: BoardConfig, color: Stone, oppColor: Stone): ThreatInfo {
  const result: ThreatInfo = { winMoves: 0, open5: 0, open4: 0, open3: 0, doubleThreat: false, doubleThreatPos: null };

  for (let z = 0; z < c.sizeZ; z++) {
    for (let y = 0; y < c.sizeY; y++) {
      for (let x = 0; x < c.sizeX; x++) {
        if (getStone(b, x, y, z, c) !== Stone.EMPTY) continue;

        let cellOpen4Count = 0;
        let cellOpen5Count = 0;

        for (const dir of DIRECTIONS) {
          const info = analyzeLine(b, c, x, y, z, dir, color);
          if (info.count >= c.winLength) result.winMoves++;
          else if (info.count === c.winLength - 1 && info.openEnds === 2) cellOpen5Count++;
          else if (info.count === c.winLength - 2 && info.openEnds === 2) cellOpen4Count++;
          else if (info.count === c.winLength - 3 && info.openEnds === 2) result.open3++;
        }

        result.open5 += cellOpen5Count;
        result.open4 += cellOpen4Count;

        // Double threat: this cell creates 2+ open-4s simultaneously
        if (cellOpen4Count >= 2 && !result.doubleThreat) {
          result.doubleThreat = true;
          result.doubleThreatPos = { x, y, z };
        }
      }
    }
  }

  return result;
}

// ─── Candidate generation ───

/**
 * Get candidate cells near existing stones (radius 4).
 * Filters to only cells that are actually on or adjacent to a line with stones.
 * This keeps the candidate count reasonable even with a large radius.
 */
function getCandidates(b: number[], c: BoardConfig): Vec3[] {
  const candidates: Vec3[] = [];
  const seen = new Set<number>();
  const RADIUS = 4;

  for (let z = 0; z < c.sizeZ; z++) {
    for (let y = 0; y < c.sizeY; y++) {
      for (let x = 0; x < c.sizeX; x++) {
        if (getStone(b, x, y, z, c) === Stone.EMPTY) continue;
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

  if (candidates.length === 0) {
    const cx = Math.floor(c.sizeX / 2), cy = Math.floor(c.sizeY / 2), cz = Math.floor(c.sizeZ / 2);
    candidates.push({ x: cx, y: cy, z: cz });
  }

  return candidates;
}

/**
 * Scored candidate with detailed evaluation.
 */
interface ScoredMove {
  pos: Vec3;
  score: number;
  attack: number;
  defend: number;
}

/**
 * Score and rank candidates. Returns top N for deeper search.
 */
function scoreCandidates(
  b: number[], c: BoardConfig,
  candidates: Vec3[],
  aiStone: Stone, oppStone: Stone,
  memory?: AiMemory,
): ScoredMove[] {
  const scored: ScoredMove[] = [];

  for (const pos of candidates) {
    const ev = evaluateMove(b, c, pos.x, pos.y, pos.z, aiStone, oppStone);
    let score = ev.total;
    if (memory) score += memory.query(b, c, pos.x, pos.y, pos.z) * 0.3;
    scored.push({ pos, score, attack: ev.attack, defend: ev.defend });
  }

  scored.sort((a, b_) => b_.score - a.score);
  return scored;
}

/**
 * Check if placing `color` at (x,y,z) creates a win.
 */
function isWinningMove(b: number[], c: BoardConfig, x: number, y: number, z: number, color: Stone): boolean {
  for (const dir of DIRECTIONS) {
    const info = analyzeLine(b, c, x, y, z, dir, color);
    if (info.count >= c.winLength) return true;
  }
  return false;
}

// ─── 2-ply minimax search ───

/**
 * Minimax with alpha-beta pruning.
 * depth=0: evaluate position
 * depth>0: try all candidate moves, recurse
 */
function minimax(
  b: number[], c: BoardConfig,
  aiStone: Stone, oppStone: Stone,
  depth: number,
  alpha: number, beta: number,
  maximizing: boolean,
): number {
  if (depth === 0) {
    return evaluateBoard(b, c, aiStone) - evaluateBoard(b, c, oppStone);
  }

  const currentStone = maximizing ? aiStone : oppStone;
  const opponentStone = maximizing ? oppStone : aiStone;
  const candidates = getCandidates(b, c);

  // Score and sort candidates for better pruning
  type Scored = { pos: Vec3; score: number };
  const scored: Scored[] = candidates.map(pos => {
    const ev = evaluateMove(b, c, pos.x, pos.y, pos.z, currentStone, opponentStone);
    return { pos, score: ev.total };
  });
  scored.sort((a, b_) => b_.score - a.score);

  // Search more candidates at deeper depths for better play
  const searchLimit = depth >= 2 ? 10 : 15;
  const topMoves = scored.slice(0, Math.min(searchLimit, scored.length));

  if (maximizing) {
    let best = -Infinity;
    for (const m of topMoves) {
      // Check for immediate win
      if (isWinningMove(b, c, m.pos.x, m.pos.y, m.pos.z, aiStone)) return 500000;

      const sim = [...b];
      setStone(sim, m.pos.x, m.pos.y, m.pos.z, c, aiStone);
      const val = minimax(sim, c, aiStone, oppStone, depth - 1, alpha, beta, false);
      best = Math.max(best, val);
      alpha = Math.max(alpha, val);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of topMoves) {
      if (isWinningMove(b, c, m.pos.x, m.pos.y, m.pos.z, oppStone)) return -500000;

      const sim = [...b];
      setStone(sim, m.pos.x, m.pos.y, m.pos.z, c, oppStone);
      const val = minimax(sim, c, aiStone, oppStone, depth - 1, alpha, beta, true);
      best = Math.min(best, val);
      beta = Math.min(beta, val);
      if (beta <= alpha) break;
    }
    return best;
  }
}

// ─── Main AI entry points ───

/**
 * Check if the AI can win with its remaining stones this turn.
 * Tries all single-stone wins first, then all two-stone combinations.
 * Returns the winning moves immediately if found.
 */
function findImmediateWin(
  b: number[], c: BoardConfig,
  aiStone: Stone, stonesToPlace: number,
): Vec3[] | null {
  const candidates = getCandidates(b, c);

  // Single stone win
  if (stonesToPlace >= 1) {
    for (const pos of candidates) {
      if (isWinningMove(b, c, pos.x, pos.y, pos.z, aiStone)) {
        return [pos];
      }
    }
  }

  // Two stone win: place first stone anywhere, check if second wins
  if (stonesToPlace >= 2) {
    for (const first of candidates) {
      const sim = [...b];
      setStone(sim, first.x, first.y, first.z, c, aiStone);
      // After placing first stone, check if any second stone wins
      const secondCandidates = getCandidates(sim, c);
      for (const second of secondCandidates) {
        if (isWinningMove(sim, c, second.x, second.y, second.z, aiStone)) {
          return [first, second];
        }
      }
    }
  }

  return null;
}

export function computeAiMove(req: AiRequestPayload): AiResponsePayload {
  const { board, config, aiColor, currentPlayer, stonesToPlace } = req;
  if (currentPlayer !== aiColor) return { moves: [] };

  const aiStone = aiColor as unknown as Stone;
  const oppStone = (aiColor === Player.BLACK ? Player.WHITE : Player.BLACK) as unknown as Stone;
  const workingBoard = [...board];

  // First check: can we win immediately?
  const winMoves = findImmediateWin(workingBoard, config, aiStone, stonesToPlace);
  if (winMoves) return { moves: winMoves };

  // Second check: do we have a guaranteed win (two open-5 threats)?
  // If so, skip defensive blocking — just build toward the win.
  const guaranteed = hasGuaranteedWin(workingBoard, config, aiStone, oppStone);

  const moves: Vec3[] = [];
  for (let m = 0; m < stonesToPlace; m++) {
    const move = pickBestMove(workingBoard, config, aiStone, oppStone, undefined, guaranteed);
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
  const workingBoard = [...board];

  // First check: can we win immediately?
  const winMoves = findImmediateWin(workingBoard, config, aiStone, stonesToPlace);
  if (winMoves) return { moves: winMoves };

  // Second check: guaranteed win (two open-5 threats)?
  const guaranteed = hasGuaranteedWin(workingBoard, config, aiStone, oppStone);

  // Normal play with memory
  const moves: Vec3[] = [];
  for (let m = 0; m < stonesToPlace; m++) {
    const move = pickBestMove(workingBoard, config, aiStone, oppStone, memory, guaranteed);
    if (!move) break;
    moves.push(move);
    setStone(workingBoard, move.x, move.y, move.z, config, aiStone);
  }

  return { moves };
}

/**
 * Find urgent blocking moves — cells where opponent threatens to win or create unstoppable threats.
 * Returns the best blocking move, or null if no urgent block needed.
 */
function findUrgentBlock(
  b: number[], c: BoardConfig,
  candidates: Vec3[],
  aiStone: Stone, oppStone: Stone,
): Vec3 | null {
  let bestBlock: Vec3 | null = null;
  let bestBlockScore = 0;

  for (const pos of candidates) {
    // Evaluate what the opponent achieves here
    let oppThreatScore = 0;

    for (const dir of DIRECTIONS) {
      const info = analyzeLine(b, c, pos.x, pos.y, pos.z, dir, oppStone);
      if (info.openEnds === 0) continue;

      // Prioritize by danger level
      if (info.count >= c.winLength) {
        // Opponent wins here — absolute must-block
        return pos;
      }
      if (info.count === c.winLength - 1 && info.openEnds >= 1) {
        // Half-open or open 5 — very urgent
        oppThreatScore += info.openEnds === 2 ? 8000 : 5000;
      }
      if (info.count === c.winLength - 2 && info.openEnds === 2) {
        // Open 4 — urgent, creates forcing sequence
        oppThreatScore += 2000;
      }
      if (info.count === c.winLength - 2 && info.openEnds === 1) {
        // Half-open 4 — still dangerous
        oppThreatScore += 800;
      }
      if (info.count === c.winLength - 3 && info.openEnds === 2) {
        // Open 3 — building threat
        oppThreatScore += 300;
      }
    }

    if (oppThreatScore > bestBlockScore) {
      bestBlockScore = oppThreatScore;
      bestBlock = pos;
    }
  }

  // Only block if the threat is significant
  return bestBlockScore >= 500 ? bestBlock : null;
}

/**
 * Check if AI has a guaranteed win next turn (e.g., two open-5 threats).
 * If so, any move that preserves both threats is winning — no need to block.
 */
function hasGuaranteedWin(
  b: number[], c: BoardConfig,
  aiStone: Stone, oppStone: Stone,
): boolean {
  const threats = countThreats(b, c, aiStone, oppStone);
  // Two or more open-5 threats = unstoppable (opponent can only block one)
  return threats.open5 >= 2;
}

/**
 * Main move selection with threat-based priority + minimax search.
 */
function pickBestMove(
  b: number[], c: BoardConfig,
  aiStone: Stone, oppStone: Stone,
  memory?: AiMemory,
  skipBlock = false,
): Vec3 | null {
  const candidates = getCandidates(b, c);
  if (candidates.length === 0) return null;

  // ── Phase 1: Check for immediate wins ──
  for (const pos of candidates) {
    if (isWinningMove(b, c, pos.x, pos.y, pos.z, aiStone)) return pos;
  }

  // ── Phase 2: Block opponent's immediate wins (unless we have guaranteed win) ──
  const oppWinMoves = candidates.filter(pos => isWinningMove(b, c, pos.x, pos.y, pos.z, oppStone));
  if (!skipBlock) {
    if (oppWinMoves.length === 1) return oppWinMoves[0];

    // ── Phase 2.5: Find urgent blocking moves ──
    const urgentBlock = findUrgentBlock(b, c, candidates, aiStone, oppStone);
    if (urgentBlock) {
      const myThreats = countThreats(b, c, aiStone, oppStone);
      if (myThreats.winMoves > 0 || myThreats.doubleThreat) {
        const oppThreats = countThreats(b, c, oppStone, aiStone);
        if (oppThreats.winMoves > 0 || oppThreats.open5 > 0 || oppThreats.open4 > 0) {
          return urgentBlock;
        }
      } else {
        return urgentBlock;
      }
    }
  }

  // ── Phase 3: Score and rank all candidates ──
  const scored = scoreCandidates(b, c, candidates, aiStone, oppStone, memory);

  // Bonus for blocking opponent's multiple winning moves
  if (oppWinMoves.length > 1) {
    for (const s of scored) {
      if (oppWinMoves.some(p => p.x === s.pos.x && p.y === s.pos.y && p.z === s.pos.z)) {
        s.score += 100000;
      }
    }
    scored.sort((a, b_) => b_.score - a.score);
  }

  // ── Phase 4: Threat analysis ──
  const myThreats = countThreats(b, c, aiStone, oppStone);
  const oppThreats = countThreats(b, c, oppStone, aiStone);

  // Create double threat
  if (myThreats.doubleThreat && myThreats.doubleThreatPos) {
    const dt = myThreats.doubleThreatPos;
    if (candidates.some(p => p.x === dt.x && p.y === dt.y && p.z === dt.z)) {
      return dt;
    }
  }

  // Block opponent's double threat
  if (oppThreats.doubleThreat && oppThreats.doubleThreatPos) {
    const blockers = scored.filter(s => {
      const sim = [...b];
      setStone(sim, s.pos.x, s.pos.y, s.pos.z, c, aiStone);
      const newOpp = countThreats(sim, c, oppStone, aiStone);
      return newOpp.open4 < oppThreats.open4;
    });
    if (blockers.length > 0) {
      blockers.sort((a, b_) => b_.score - a.score);
      return blockers[0].pos;
    }
  }

  // ── Phase 5: Minimax on top candidates ──
  const topN = scored.slice(0, Math.min(12, scored.length));

  // If top candidate is overwhelmingly good, take it
  if (topN.length > 0 && topN[0].score > 10000) return topN[0].pos;

  let bestMove = topN[0]?.pos || scored[0]?.pos || candidates[0];
  let bestEval = -Infinity;

  for (const candidate of topN) {
    const sim = [...b];
    setStone(sim, candidate.pos.x, candidate.pos.y, candidate.pos.z, c, aiStone);

    // 2-ply minimax
    const eval_ = minimax(sim, c, aiStone, oppStone, 2, -Infinity, Infinity, false);
    const combined = eval_ + candidate.score * 0.1;

    if (combined > bestEval) {
      bestEval = combined;
      bestMove = candidate.pos;
    }
  }

  // Safety fallback: if somehow no move was picked, take any empty cell
  if (!bestMove) {
    for (let z = 0; z < c.sizeZ; z++) {
      for (let y = 0; y < c.sizeY; y++) {
        for (let x = 0; x < c.sizeX; x++) {
          if (getStone(b, x, y, z, c) === Stone.EMPTY) return { x, y, z };
        }
      }
    }
  }

  return bestMove;
}

// Backward compatibility export
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
