import {
  type AiRequestPayload,
  type AiResponsePayload,
  type BoardConfig,
  type Direction,
  Stone,
  type Vec3,
} from "./types";
import { DIRECTIONS } from "./engine";

const WIN_SCORE = 1_000_000_000;
const ROOT_REPLY_WIDTH = 4;

interface LineInfo {
  count: number;
  openEnds: number;
  potential: number;
  span: number;
}

interface RayInfo {
  consecutive: number;
  open: boolean;
  emptyReach: number;
  reachable: number;
}

interface MoveEvaluation {
  attack: number;
  defend: number;
  total: number;
}

interface ScoredMove extends MoveEvaluation {
  pos: Vec3;
}

interface TurnCandidate {
  moves: Vec3[];
  board: number[];
  heuristic: number;
  winsNow: boolean;
  ownWinsNext: number;
  opponentWinsNext: number;
}

interface PairLimits {
  first: number;
  second: number;
  maxPairs: number;
}

function indexOf(x: number, y: number, z: number, c: BoardConfig): number {
  return z * c.sizeY * c.sizeX + y * c.sizeX + x;
}

function inBounds(x: number, y: number, z: number, c: BoardConfig): boolean {
  return x >= 0 && x < c.sizeX && y >= 0 && y < c.sizeY && z >= 0 && z < c.sizeZ;
}

function getStone(board: number[], x: number, y: number, z: number, c: BoardConfig): Stone {
  return board[indexOf(x, y, z, c)] as Stone;
}

function setStone(board: number[], pos: Vec3, c: BoardConfig, stone: Stone): void {
  board[indexOf(pos.x, pos.y, pos.z, c)] = stone;
}

function opposite(stone: Stone): Stone {
  return stone === Stone.BLACK ? Stone.WHITE : Stone.BLACK;
}

function posKey(pos: Vec3): string {
  return `${pos.x},${pos.y},${pos.z}`;
}

function samePosition(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function countStones(board: number[]): number {
  let count = 0;
  for (const stone of board) if (stone !== Stone.EMPTY) count++;
  return count;
}

function centerDistance(pos: Vec3, c: BoardConfig): number {
  const cx = (c.sizeX - 1) / 2;
  const cy = (c.sizeY - 1) / 2;
  const cz = (c.sizeZ - 1) / 2;
  return Math.abs(pos.x - cx) / c.sizeX
    + Math.abs(pos.y - cy) / c.sizeY
    + Math.abs(pos.z - cz) / c.sizeZ;
}

function scanRay(
  board: number[], c: BoardConfig,
  x: number, y: number, z: number,
  dir: Direction, color: Stone,
): RayInfo {
  let consecutive = 0;
  let emptyReach = 0;
  let reachable = 0;
  let contiguous = true;
  let cx = x + dir.x;
  let cy = y + dir.y;
  let cz = z + dir.z;
  const firstStone = inBounds(cx, cy, cz, c) ? getStone(board, cx, cy, cz, c) : null;

  while (inBounds(cx, cy, cz, c)) {
    const stone = getStone(board, cx, cy, cz, c);
    if (stone !== Stone.EMPTY && stone !== color) break;
    reachable++;
    if (stone === Stone.EMPTY) {
      emptyReach++;
      contiguous = false;
    } else if (contiguous) {
      consecutive++;
    }
    cx += dir.x;
    cy += dir.y;
    cz += dir.z;
  }

  return {
    consecutive,
    open: firstStone === Stone.EMPTY,
    emptyReach,
    reachable,
  };
}

/** Analyze the contiguous run created by treating the target cell as `color`. */
function analyzeLine(
  board: number[], c: BoardConfig,
  x: number, y: number, z: number,
  dir: Direction, color: Stone,
): LineInfo {
  const forward = scanRay(board, c, x, y, z, dir, color);
  const backward = scanRay(
    board, c, x, y, z,
    { x: -dir.x, y: -dir.y, z: -dir.z },
    color,
  );

  return {
    count: 1 + forward.consecutive + backward.consecutive,
    openEnds: Number(forward.open) + Number(backward.open),
    potential: forward.emptyReach + backward.emptyReach,
    span: 1 + forward.reachable + backward.reachable,
  };
}

function contiguousScore(info: LineInfo, winLength: number): number {
  if (info.count >= winLength) return WIN_SCORE;
  if (info.span < winLength || info.openEnds === 0) return 0;

  const gap = winLength - info.count;
  const halfOpen = [0, 180_000, 14_000, 850, 75, 12, 3];
  const fullyOpen = [0, 310_000, 34_000, 2_400, 220, 32, 6];
  const table = info.openEnds === 2 ? fullyOpen : halfOpen;
  const base = table[Math.min(gap, table.length - 1)] ?? 2;
  return base + Math.min(info.potential, winLength) * 0.2;
}

function windowBaseScore(stones: number, winLength: number): number {
  const gap = winLength - stones;
  if (gap <= 0) return WIN_SCORE;
  const scores = [0, 125_000, 7_500, 520, 48, 9, 3];
  return scores[Math.min(gap, scores.length - 1)] ?? Math.max(2, stones * 2);
}

/**
 * Scores every win-length window containing the target. Unlike contiguous-only
 * evaluation, this recognizes bridge moves such as XX_XX and 3D broken lines.
 */
function directionPatternScore(
  board: number[], c: BoardConfig,
  x: number, y: number, z: number,
  dir: Direction, color: Stone,
): number {
  let bestWindow = 0;

  for (let start = -(c.winLength - 1); start <= 0; start++) {
    let stones = 0;
    let blocked = false;
    let firstStone = c.winLength;
    let lastStone = -1;
    const cells: Stone[] = [];

    for (let offset = 0; offset < c.winLength; offset++) {
      const step = start + offset;
      const cx = x + step * dir.x;
      const cy = y + step * dir.y;
      const cz = z + step * dir.z;
      if (!inBounds(cx, cy, cz, c)) {
        blocked = true;
        break;
      }
      const stone = step === 0 ? color : getStone(board, cx, cy, cz, c);
      cells.push(stone);
      if (stone !== Stone.EMPTY && stone !== color) {
        blocked = true;
        break;
      }
      if (stone === color) {
        stones++;
        firstStone = Math.min(firstStone, offset);
        lastStone = offset;
      }
    }
    if (blocked) continue;

    let internalGaps = 0;
    for (let i = firstStone; i <= lastStone; i++) {
      if (cells[i] === Stone.EMPTY) internalGaps++;
    }

    const beforeStep = start - 1;
    const afterStep = start + c.winLength;
    const beforeOpen = inBounds(
      x + beforeStep * dir.x,
      y + beforeStep * dir.y,
      z + beforeStep * dir.z,
      c,
    ) && getStone(
      board,
      x + beforeStep * dir.x,
      y + beforeStep * dir.y,
      z + beforeStep * dir.z,
      c,
    ) === Stone.EMPTY;
    const afterOpen = inBounds(
      x + afterStep * dir.x,
      y + afterStep * dir.y,
      z + afterStep * dir.z,
      c,
    ) && getStone(
      board,
      x + afterStep * dir.x,
      y + afterStep * dir.y,
      z + afterStep * dir.z,
      c,
    ) === Stone.EMPTY;

    const openness = Number(beforeOpen) + Number(afterOpen);
    const gapPenalty = Math.pow(0.7, internalGaps);
    const score = windowBaseScore(stones, c.winLength)
      * gapPenalty
      * (1 + openness * 0.14);
    bestWindow = Math.max(bestWindow, score);
  }

  const contiguous = contiguousScore(analyzeLine(board, c, x, y, z, dir, color), c.winLength);
  return Math.max(bestWindow, contiguous);
}

function evaluateMove(
  board: number[], c: BoardConfig,
  pos: Vec3, color: Stone, opponent: Stone,
): MoveEvaluation {
  const attackScores: number[] = [];
  const defendScores: number[] = [];

  for (const dir of DIRECTIONS) {
    attackScores.push(directionPatternScore(board, c, pos.x, pos.y, pos.z, dir, color));
    defendScores.push(directionPatternScore(board, c, pos.x, pos.y, pos.z, dir, opponent));
  }

  attackScores.sort((a, b) => b - a);
  defendScores.sort((a, b) => b - a);
  const attack = attackScores.reduce((sum, score) => sum + score, 0);
  const defend = defendScores.reduce((sum, score) => sum + score, 0);
  const attackFork = (attackScores[1] ?? 0) * 0.72 + (attackScores[2] ?? 0) * 0.28;
  const defendFork = (defendScores[1] ?? 0) * 0.62;
  const urgency = defendScores[0] >= WIN_SCORE
    ? 2
    : defendScores[0] >= 100_000
      ? 1.55
      : defendScores[0] >= 7_000
        ? 1.3
        : 1.12;
  const centerBonus = Math.max(0, 1 - centerDistance(pos, c)) * 28;

  return {
    attack,
    defend,
    total: attack + attackFork + defend * urgency + defendFork + centerBonus,
  };
}

function evaluateBoard(board: number[], c: BoardConfig, color: Stone): number {
  let total = 0;
  for (let z = 0; z < c.sizeZ; z++) {
    for (let y = 0; y < c.sizeY; y++) {
      for (let x = 0; x < c.sizeX; x++) {
        if (getStone(board, x, y, z, c) !== color) continue;
        for (const dir of DIRECTIONS) {
          const px = x - dir.x;
          const py = y - dir.y;
          const pz = z - dir.z;
          if (inBounds(px, py, pz, c) && getStone(board, px, py, pz, c) === color) continue;
          total += contiguousScore(analyzeLine(board, c, x, y, z, dir, color), c.winLength);
        }
      }
    }
  }
  return total;
}

function getCandidates(board: number[], c: BoardConfig): Vec3[] {
  const candidates: Vec3[] = [];
  const seen = new Set<number>();
  const radius = Math.max(1, c.winLength - 1);

  for (let z = 0; z < c.sizeZ; z++) {
    for (let y = 0; y < c.sizeY; y++) {
      for (let x = 0; x < c.sizeX; x++) {
        if (getStone(board, x, y, z, c) === Stone.EMPTY) continue;
        for (const dir of DIRECTIONS) {
          for (const sign of [-1, 1]) {
            for (let distance = 1; distance <= radius; distance++) {
              const nx = x + dir.x * distance * sign;
              const ny = y + dir.y * distance * sign;
              const nz = z + dir.z * distance * sign;
              if (!inBounds(nx, ny, nz, c)) break;
              if (getStone(board, nx, ny, nz, c) !== Stone.EMPTY) continue;
              const index = indexOf(nx, ny, nz, c);
              if (seen.has(index)) continue;
              seen.add(index);
              candidates.push({ x: nx, y: ny, z: nz });
            }
          }
        }
      }
    }
  }

  if (candidates.length === 0) {
    candidates.push({
      x: Math.floor(c.sizeX / 2),
      y: Math.floor(c.sizeY / 2),
      z: Math.floor(c.sizeZ / 2),
    });
  }
  return candidates;
}

function scoreCandidates(
  board: number[], c: BoardConfig,
  candidates: Vec3[], color: Stone, opponent: Stone,
): ScoredMove[] {
  return candidates.map((pos) => ({ pos, ...evaluateMove(board, c, pos, color, opponent) }))
    .sort((a, b) => {
      const byScore = b.total - a.total;
      if (byScore !== 0) return byScore;
      const byCenter = centerDistance(a.pos, c) - centerDistance(b.pos, c);
      return byCenter !== 0 ? byCenter : posKey(a.pos).localeCompare(posKey(b.pos));
    });
}

function isWinningMove(board: number[], c: BoardConfig, pos: Vec3, color: Stone): boolean {
  return DIRECTIONS.some((dir) =>
    analyzeLine(board, c, pos.x, pos.y, pos.z, dir, color).count >= c.winLength);
}

function findWinningCells(
  board: number[], c: BoardConfig, color: Stone, cap = Number.POSITIVE_INFINITY,
): Vec3[] {
  const result: Vec3[] = [];
  for (const pos of getCandidates(board, c)) {
    if (!isWinningMove(board, c, pos, color)) continue;
    result.push(pos);
    if (result.length >= cap) break;
  }
  return result;
}

function findImmediateWin(
  board: number[], c: BoardConfig,
  color: Stone, opponent: Stone, stonesToPlace: number,
): Vec3[] | null {
  const singleWins = findWinningCells(board, c, color, 1);
  if (singleWins.length > 0) return [singleWins[0]];
  if (stonesToPlace < 2) return null;

  const firstMoves = scoreCandidates(board, c, getCandidates(board, c), color, opponent)
    .sort((a, b) => b.attack - a.attack)
    .slice(0, 48);

  for (const first of firstMoves) {
    const afterFirst = [...board];
    setStone(afterFirst, first.pos, c, color);
    const secondWins = findWinningCells(afterFirst, c, color, 1);
    if (secondWins.length > 0) return [first.pos, secondWins[0]];
  }
  return null;
}

function mergeUniquePositions(...groups: Vec3[][]): Vec3[] {
  const result: Vec3[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const pos of group) {
      const key = posKey(pos);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(pos);
    }
  }
  return result;
}

function evaluatePosition(
  board: number[], c: BoardConfig, color: Stone, opponent: Stone,
): number {
  const ownWins = findWinningCells(board, c, color, 4).length;
  const opponentWins = findWinningCells(board, c, opponent, 4).length;
  return evaluateBoard(board, c, color)
    - evaluateBoard(board, c, opponent) * 1.1
    + ownWins * 14_000_000
    - opponentWins * 18_000_000;
}

function turnKey(moves: Vec3[]): string {
  return moves.map(posKey).sort().join("|");
}

function generatePairCandidates(
  board: number[], c: BoardConfig,
  color: Stone, opponent: Stone,
  limits: PairLimits,
): TurnCandidate[] {
  const candidates = getCandidates(board, c);
  if (candidates.length === 0) return [];

  const originalOpponentWins = findWinningCells(board, c, opponent, 8);
  const originalWinKeys = new Set(originalOpponentWins.map(posKey));
  const firstScored = scoreCandidates(board, c, candidates, color, opponent);
  const firstPool = mergeUniquePositions(
    originalOpponentWins,
    firstScored.slice(0, limits.first).map((move) => move.pos),
  );
  const firstScores = new Map(firstScored.map((move) => [posKey(move.pos), move.total]));
  const results: TurnCandidate[] = [];
  const seenPairs = new Set<string>();

  for (const first of firstPool) {
    const afterFirst = [...board];
    setStone(afterFirst, first, c, color);
    const secondCandidates = getCandidates(afterFirst, c);

    if (secondCandidates.length === 0) {
      results.push({
        moves: [first],
        board: afterFirst,
        heuristic: firstScores.get(posKey(first)) ?? 0,
        winsNow: false,
        ownWinsNext: 0,
        opponentWinsNext: 0,
      });
      continue;
    }

    const opponentWinsAfterFirst = findWinningCells(afterFirst, c, opponent, 8);
    const secondScored = scoreCandidates(afterFirst, c, secondCandidates, color, opponent);
    const secondPool = mergeUniquePositions(
      opponentWinsAfterFirst,
      secondScored.slice(0, limits.second).map((move) => move.pos),
    );
    const secondScores = new Map(secondScored.map((move) => [posKey(move.pos), move.total]));

    for (const second of secondPool) {
      const pairKey = turnKey([first, second]);
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const winsNow = isWinningMove(afterFirst, c, second, color);
      const afterPair = [...afterFirst];
      setStone(afterPair, second, c, color);
      const ownWinsNext = winsNow ? 4 : findWinningCells(afterPair, c, color, 4).length;
      const opponentWinsNext = findWinningCells(afterPair, c, opponent, 4).length;
      const blockedOriginal = Number(originalWinKeys.has(posKey(first)))
        + Number(originalWinKeys.has(posKey(second)));
      const unblockedOriginal = Math.max(0, originalOpponentWins.length - blockedOriginal);
      const positionBalance = evaluateBoard(afterPair, c, color)
        - evaluateBoard(afterPair, c, opponent) * 1.1;
      const heuristic = (firstScores.get(posKey(first)) ?? 0)
        + (secondScores.get(posKey(second)) ?? 0) * 1.08
        + positionBalance * 0.08
        + ownWinsNext * 13_000_000
        - opponentWinsNext * 22_000_000
        + blockedOriginal * 20_000_000
        - unblockedOriginal * 30_000_000
        + (winsNow ? WIN_SCORE : 0);

      results.push({
        moves: [first, second],
        board: afterPair,
        heuristic,
        winsNow,
        ownWinsNext,
        opponentWinsNext,
      });
    }
  }

  return results.sort((a, b) => {
    const byScore = b.heuristic - a.heuristic;
    return byScore !== 0 ? byScore : turnKey(a.moves).localeCompare(turnKey(b.moves));
  }).slice(0, limits.maxPairs);
}

function chooseBestPair(
  board: number[], c: BoardConfig,
  color: Stone, opponent: Stone,
): Vec3[] | null {
  const roots = generatePairCandidates(
    board, c, color, opponent,
    { first: 12, second: 8, maxPairs: 20 },
  );
  if (roots.length === 0) return null;
  if (roots[0].winsNow) return roots[0].moves;

  let best = roots[0];
  let bestValue = -Infinity;

  for (const root of roots.slice(0, ROOT_REPLY_WIDTH)) {
    if (root.ownWinsNext >= 3 && root.opponentWinsNext === 0) return root.moves;

    const replies = generatePairCandidates(
      root.board, c, opponent, color,
      { first: 4, second: 3, maxPairs: 8 },
    );
    let worstReply = evaluatePosition(root.board, c, color, opponent);

    if (replies.length > 0) {
      worstReply = Infinity;
      for (const reply of replies) {
        const value = reply.winsNow
          ? -WIN_SCORE
          : evaluatePosition(reply.board, c, color, opponent);
        worstReply = Math.min(worstReply, value);
      }
    }

    const value = worstReply + root.heuristic * 0.06;
    if (value > bestValue || (value === bestValue && turnKey(root.moves) < turnKey(best.moves))) {
      bestValue = value;
      best = root;
    }
  }

  return best.moves;
}

function chooseBestSingle(
  board: number[], c: BoardConfig,
  color: Stone, opponent: Stone,
): Vec3 | null {
  const candidates = getCandidates(board, c);
  if (candidates.length === 0) return null;

  const opponentWins = findWinningCells(board, c, opponent, 8);
  const pool = opponentWins.length > 0 ? opponentWins : candidates;
  const scored = scoreCandidates(board, c, pool, color, opponent).slice(0, 14);
  let best = scored[0]?.pos ?? candidates[0];
  let bestValue = -Infinity;

  for (const move of scored) {
    const simulated = [...board];
    setStone(simulated, move.pos, c, color);
    const value = evaluatePosition(simulated, c, color, opponent) + move.total * 0.08;
    if (value > bestValue) {
      bestValue = value;
      best = move.pos;
    }
  }
  return best;
}

export function computeAiMove(request: AiRequestPayload): AiResponsePayload {
  const { board, config, aiColor, currentPlayer, stonesToPlace } = request;
  const expectedSize = config.sizeX * config.sizeY * config.sizeZ;
  if (currentPlayer !== aiColor || stonesToPlace <= 0 || board.length !== expectedSize) {
    return { moves: [] };
  }
  if (!board.some((stone) => stone === Stone.EMPTY)) return { moves: [] };

  const color = aiColor as unknown as Stone;
  const opponent = opposite(color);
  const workingBoard = [...board];

  // Deterministic central opening maximizes the 13-direction option space.
  if (countStones(workingBoard) === 0) {
    return { moves: [getCandidates(workingBoard, config)[0]] };
  }

  const win = findImmediateWin(workingBoard, config, color, opponent, stonesToPlace);
  if (win) return { moves: win.slice(0, stonesToPlace) };

  if (stonesToPlace >= 2) {
    const pair = chooseBestPair(workingBoard, config, color, opponent);
    if (pair) return { moves: pair.slice(0, stonesToPlace) };
  }

  const move = chooseBestSingle(workingBoard, config, color, opponent);
  return { moves: move ? [move] : [] };
}

/** Highest directional tactical value for training analysis and diagnostics. */
export function scoreCell(
  board: number[], config: BoardConfig,
  x: number, y: number, z: number,
  color: Stone,
): number {
  if (!inBounds(x, y, z, config) || getStone(board, x, y, z, config) !== Stone.EMPTY) return 0;
  let best = 0;
  for (const dir of DIRECTIONS) {
    best = Math.max(best, directionPatternScore(board, config, x, y, z, dir, color));
  }
  return best;
}
