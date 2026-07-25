import {
  type AiRequestPayload,
  type AiResponsePayload,
  type BoardConfig,
  Player,
  Stone,
  type Vec3,
} from "./types";
import { DIRECTIONS } from "./engine";

const MATE_SCORE = 1_000_000_000_000;
const FORCED_SCORE = 500_000_000_000;
const ROOT_TURN_WIDTH = 48;
const REPLY_TURN_WIDTH = 24;
const ROOT_SEARCH_WIDTH = 10;
const REPLY_SEARCH_WIDTH = 14;
const QUIET_CELL_WIDTH = 22;
const COVER_COMPLETION_WIDTH = 14;
const SYNERGY_PAIR_WIDTH = 120;

interface LineWindow {
  cells: number[];
}

interface Geometry {
  positions: Vec3[];
  windows: LineWindow[];
  windowsByCell: number[][];
}

interface WindowState {
  black: number;
  white: number;
  empty: number;
}

interface PositionContext {
  board: number[];
  config: BoardConfig;
  geometry: Geometry;
  states: WindowState[];
  blackPotential: number;
  whitePotential: number;
}

interface RankedCell {
  index: number;
  score: number;
}

interface WinningTurn {
  cells: number[];
}

interface TurnOption {
  cells: number[];
  quickScore: number;
}

interface RootOption extends TurnOption {
  context: PositionContext;
  opponentWins: WinningTurn[];
  ownThreats: WinningTurn[];
  forcedNext: boolean;
}

const geometryCache = new Map<string, Geometry>();

function configKey(config: BoardConfig): string {
  return `${config.sizeX}x${config.sizeY}x${config.sizeZ}:${config.winLength}`;
}

function indexOf(x: number, y: number, z: number, config: BoardConfig): number {
  return z * config.sizeY * config.sizeX + y * config.sizeX + x;
}

function inBounds(x: number, y: number, z: number, config: BoardConfig): boolean {
  return x >= 0 && x < config.sizeX
    && y >= 0 && y < config.sizeY
    && z >= 0 && z < config.sizeZ;
}

function opposite(color: Stone): Stone {
  return color === Stone.BLACK ? Stone.WHITE : Stone.BLACK;
}

function colorCount(state: WindowState, color: Stone): number {
  return color === Stone.BLACK ? state.black : state.white;
}

function opponentCount(state: WindowState, color: Stone): number {
  return color === Stone.BLACK ? state.white : state.black;
}

function buildGeometry(config: BoardConfig): Geometry {
  const key = configKey(config);
  const cached = geometryCache.get(key);
  if (cached) return cached;

  const size = config.sizeX * config.sizeY * config.sizeZ;
  const positions = Array.from({ length: size }, (_, index) => {
    const plane = config.sizeX * config.sizeY;
    const z = Math.floor(index / plane);
    const withinPlane = index - z * plane;
    return {
      x: withinPlane % config.sizeX,
      y: Math.floor(withinPlane / config.sizeX),
      z,
    };
  });
  const windows: LineWindow[] = [];
  const windowsByCell = Array.from({ length: size }, () => [] as number[]);

  for (const direction of DIRECTIONS) {
    for (let z = 0; z < config.sizeZ; z++) {
      for (let y = 0; y < config.sizeY; y++) {
        for (let x = 0; x < config.sizeX; x++) {
          const endX = x + direction.x * (config.winLength - 1);
          const endY = y + direction.y * (config.winLength - 1);
          const endZ = z + direction.z * (config.winLength - 1);
          if (!inBounds(endX, endY, endZ, config)) continue;

          const cells: number[] = [];
          for (let step = 0; step < config.winLength; step++) {
            cells.push(indexOf(
              x + direction.x * step,
              y + direction.y * step,
              z + direction.z * step,
              config,
            ));
          }
          const windowIndex = windows.length;
          windows.push({ cells });
          for (const cell of cells) windowsByCell[cell].push(windowIndex);
        }
      }
    }
  }

  const geometry = { positions, windows, windowsByCell };
  geometryCache.set(key, geometry);
  return geometry;
}

function patternValue(stones: number, winLength: number): number {
  if (stones <= 0) return 0;
  const gap = winLength - stones;
  if (gap <= 0) return 100_000_000;
  if (gap === 1) return 2_400_000;
  if (gap === 2) return 120_000;
  if (gap === 3) return 5_500;
  if (gap === 4) return 280;
  if (gap === 5) return 18;
  return Math.max(2, Math.pow(3, stones - 1));
}

function windowPotential(state: WindowState, color: Stone, winLength: number): number {
  if (opponentCount(state, color) > 0) return 0;
  return patternValue(colorCount(state, color), winLength);
}

function analyzeBoard(
  board: number[],
  config: BoardConfig,
  geometry: Geometry,
): PositionContext {
  const states: WindowState[] = [];
  let blackPotential = 0;
  let whitePotential = 0;

  for (const window of geometry.windows) {
    let black = 0;
    let white = 0;
    for (const cell of window.cells) {
      if (board[cell] === Stone.BLACK) black++;
      else if (board[cell] === Stone.WHITE) white++;
    }
    const state = {
      black,
      white,
      empty: config.winLength - black - white,
    };
    states.push(state);
    blackPotential += windowPotential(state, Stone.BLACK, config.winLength);
    whitePotential += windowPotential(state, Stone.WHITE, config.winLength);
  }

  return {
    board,
    config,
    geometry,
    states,
    blackPotential,
    whitePotential,
  };
}

function positionScore(context: PositionContext, color: Stone): number {
  const own = color === Stone.BLACK ? context.blackPotential : context.whitePotential;
  const opponent = color === Stone.BLACK ? context.whitePotential : context.blackPotential;
  return own - opponent * 1.08;
}

function centerDistance(position: Vec3, config: BoardConfig): number {
  const cx = (config.sizeX - 1) / 2;
  const cy = (config.sizeY - 1) / 2;
  const cz = (config.sizeZ - 1) / 2;
  return Math.abs(position.x - cx) / Math.max(1, config.sizeX)
    + Math.abs(position.y - cy) / Math.max(1, config.sizeY)
    + Math.abs(position.z - cz) / Math.max(1, config.sizeZ);
}

function compareCellIndices(a: number, b: number, geometry: Geometry, config: BoardConfig): number {
  const byCenter = centerDistance(geometry.positions[a], config)
    - centerDistance(geometry.positions[b], config);
  return byCenter !== 0 ? byCenter : a - b;
}

function compareTurns(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function turnKey(cells: number[]): string {
  return [...cells].sort((a, b) => a - b).join(",");
}

function canonicalTurn(cells: number[]): number[] {
  return [...new Set(cells)].sort((a, b) => a - b);
}

function collectWinningTurns(
  context: PositionContext,
  color: Stone,
  stonesAvailable: number,
): WinningTurn[] {
  const result: WinningTurn[] = [];
  const seen = new Set<string>();

  for (let windowIndex = 0; windowIndex < context.geometry.windows.length; windowIndex++) {
    const state = context.states[windowIndex];
    if (opponentCount(state, color) > 0) continue;
    const needed = context.config.winLength - colorCount(state, color);
    if (needed < 1 || needed > stonesAvailable || needed > 2) continue;

    const cells = context.geometry.windows[windowIndex].cells
      .filter((cell) => context.board[cell] === Stone.EMPTY)
      .sort((a, b) => a - b);
    if (cells.length !== needed) continue;
    const key = turnKey(cells);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ cells });
  }

  return result.sort((a, b) => compareTurns(a.cells, b.cells));
}

function isThreatCovered(threat: WinningTurn, chosen: number[]): boolean {
  return threat.cells.some((cell) => chosen.includes(cell));
}

/**
 * Enumerates every minimal hitting set of at most `maxStones` cells.
 * A defensive turn is valid only when it intersects every opponent winning turn.
 */
function enumerateThreatCovers(threats: WinningTurn[], maxStones: number): number[][] {
  if (threats.length === 0) return [[]];
  const results: number[][] = [];
  const seen = new Set<string>();

  const visit = (chosen: number[]) => {
    const remaining = threats.filter((threat) => !isThreatCovered(threat, chosen));
    if (remaining.length === 0) {
      const cover = canonicalTurn(chosen);
      const key = turnKey(cover);
      if (!seen.has(key)) {
        seen.add(key);
        results.push(cover);
      }
      return;
    }
    if (chosen.length >= maxStones) return;

    const pivot = remaining.reduce((best, threat) =>
      threat.cells.length < best.cells.length ? threat : best);
    for (const cell of pivot.cells) {
      if (chosen.includes(cell)) continue;
      visit([...chosen, cell]);
    }
  };

  visit([]);
  return results.sort(compareTurns);
}

function rankCells(context: PositionContext, color: Stone): RankedCell[] {
  const ranked: RankedCell[] = [];
  const opponent = opposite(color);

  for (let cell = 0; cell < context.board.length; cell++) {
    if (context.board[cell] !== Stone.EMPTY) continue;
    let attack = 0;
    let defense = 0;
    let strongestAttack = 0;
    let secondAttack = 0;
    let strongestDefense = 0;

    for (const windowIndex of context.geometry.windowsByCell[cell]) {
      const state = context.states[windowIndex];
      if (opponentCount(state, color) === 0) {
        const before = windowPotential(state, color, context.config.winLength);
        const after = patternValue(colorCount(state, color) + 1, context.config.winLength);
        const gain = Math.max(0, after - before);
        attack += gain;
        if (gain > strongestAttack) {
          secondAttack = strongestAttack;
          strongestAttack = gain;
        } else if (gain > secondAttack) {
          secondAttack = gain;
        }
      }
      if (opponentCount(state, opponent) === 0) {
        const saved = windowPotential(state, opponent, context.config.winLength);
        defense += saved;
        strongestDefense = Math.max(strongestDefense, saved);
      }
    }

    const forkBonus = secondAttack * 0.62 + strongestAttack * 0.08;
    const urgentDefense = strongestDefense >= patternValue(
      context.config.winLength - 2,
      context.config.winLength,
    ) ? 1.32 : 1.1;
    const centrality = Math.max(
      0,
      1.5 - centerDistance(context.geometry.positions[cell], context.config),
    ) * 36 + context.geometry.windowsByCell[cell].length * 0.15;
    ranked.push({
      index: cell,
      score: attack + forkBonus + defense * urgentDefense + centrality,
    });
  }

  return ranked.sort((a, b) => {
    const byScore = b.score - a.score;
    return byScore !== 0
      ? byScore
      : compareCellIndices(a.index, b.index, context.geometry, context.config);
  });
}

function affectedWindowCounts(context: PositionContext, cells: number[]): Map<number, number> {
  const affected = new Map<number, number>();
  for (const cell of cells) {
    for (const windowIndex of context.geometry.windowsByCell[cell]) {
      affected.set(windowIndex, (affected.get(windowIndex) ?? 0) + 1);
    }
  }
  return affected;
}

function stateAfterAdds(state: WindowState, color: Stone, count: number): WindowState {
  return color === Stone.BLACK
    ? { black: state.black + count, white: state.white, empty: state.empty - count }
    : { black: state.black, white: state.white + count, empty: state.empty - count };
}

function quickPositionScoreAfter(
  context: PositionContext,
  cells: number[],
  color: Stone,
): { score: number; tacticalBonus: number; wins: boolean } {
  let blackPotential = context.blackPotential;
  let whitePotential = context.whitePotential;
  let tacticalBonus = 0;
  let wins = false;

  for (const [windowIndex, added] of affectedWindowCounts(context, cells)) {
    const before = context.states[windowIndex];
    const after = stateAfterAdds(before, color, added);
    blackPotential -= windowPotential(before, Stone.BLACK, context.config.winLength);
    whitePotential -= windowPotential(before, Stone.WHITE, context.config.winLength);
    blackPotential += windowPotential(after, Stone.BLACK, context.config.winLength);
    whitePotential += windowPotential(after, Stone.WHITE, context.config.winLength);

    if (opponentCount(after, color) > 0) continue;
    const gap = context.config.winLength - colorCount(after, color);
    if (gap <= 0) wins = true;
    else if (gap === 1) tacticalBonus += 12_000_000;
    else if (gap === 2) tacticalBonus += 900_000;
    else if (gap === 3) tacticalBonus += 28_000;
  }

  const own = color === Stone.BLACK ? blackPotential : whitePotential;
  const opponent = color === Stone.BLACK ? whitePotential : blackPotential;
  return {
    score: own - opponent * 1.08,
    tacticalBonus,
    wins,
  };
}

function applyCells(context: PositionContext, cells: number[], color: Stone): PositionContext {
  const board = [...context.board];
  for (const cell of cells) board[cell] = color;
  return analyzeBoard(board, context.config, context.geometry);
}

function addTurn(target: Map<string, number[]>, cells: number[], context: PositionContext): void {
  const turn = canonicalTurn(cells);
  if (turn.length === 0 || turn.some((cell) => context.board[cell] !== Stone.EMPTY)) return;
  target.set(turnKey(turn), turn);
}

function completeCover(
  cover: number[],
  stonesToPlace: number,
  ranked: RankedCell[],
  context: PositionContext,
  target: Map<string, number[]>,
): void {
  if (cover.length >= stonesToPlace) {
    addTurn(target, cover.slice(0, stonesToPlace), context);
    return;
  }

  const available = ranked
    .filter((cell) => !cover.includes(cell.index))
    .slice(0, COVER_COMPLETION_WIDTH);
  const remaining = stonesToPlace - cover.length;
  if (remaining === 1) {
    for (const cell of available) addTurn(target, [...cover, cell.index], context);
    return;
  }

  for (let first = 0; first < available.length; first++) {
    for (let second = first + 1; second < available.length; second++) {
      addTurn(target, [...cover, available[first].index, available[second].index], context);
    }
  }
}

function addSynergyPairs(
  context: PositionContext,
  color: Stone,
  scoreByCell: Map<number, number>,
  target: Map<string, number[]>,
): void {
  const opponent = opposite(color);
  const suggestions: { cells: number[]; priority: number }[] = [];

  for (let windowIndex = 0; windowIndex < context.geometry.windows.length; windowIndex++) {
    const state = context.states[windowIndex];
    if (state.empty < 2) continue;

    let priority = 0;
    if (opponentCount(state, color) === 0 && colorCount(state, color) >= 1) {
      priority = Math.max(
        priority,
        patternValue(
          Math.min(context.config.winLength, colorCount(state, color) + 2),
          context.config.winLength,
        ) - windowPotential(state, color, context.config.winLength),
      );
    }
    if (opponentCount(state, opponent) === 0 && colorCount(state, opponent) >= 2) {
      priority = Math.max(
        priority,
        windowPotential(state, opponent, context.config.winLength) * 1.12,
      );
    }
    if (priority <= 0) continue;

    const empties = context.geometry.windows[windowIndex].cells
      .filter((cell) => context.board[cell] === Stone.EMPTY)
      .sort((a, b) => (scoreByCell.get(b) ?? 0) - (scoreByCell.get(a) ?? 0) || a - b)
      .slice(0, 3);
    for (let first = 0; first < empties.length; first++) {
      for (let second = first + 1; second < empties.length; second++) {
        suggestions.push({
          cells: canonicalTurn([empties[first], empties[second]]),
          priority: priority
            + (scoreByCell.get(empties[first]) ?? 0) * 0.05
            + (scoreByCell.get(empties[second]) ?? 0) * 0.05,
        });
      }
    }
  }

  suggestions.sort((a, b) =>
    b.priority - a.priority || compareTurns(a.cells, b.cells));
  for (const suggestion of suggestions.slice(0, SYNERGY_PAIR_WIDTH)) {
    addTurn(target, suggestion.cells, context);
  }
}

function generateTurnCandidates(
  context: PositionContext,
  color: Stone,
  stonesToPlace: number,
  width: number,
): TurnOption[] {
  const ranked = rankCells(context, color);
  if (ranked.length === 0) return [];
  const actualStones = Math.min(stonesToPlace, ranked.length);
  const opponentThreats = collectWinningTurns(context, opposite(color), 2);
  const covers = enumerateThreatCovers(opponentThreats, actualStones);
  const turns = new Map<string, number[]>();

  if (opponentThreats.length > 0 && covers.length > 0) {
    for (const cover of covers) {
      completeCover(cover, actualStones, ranked, context, turns);
    }
  } else if (actualStones === 1) {
    const threatCells = opponentThreats.flatMap((threat) => threat.cells);
    const pool = [...new Set([
      ...threatCells,
      ...ranked.slice(0, Math.max(width, QUIET_CELL_WIDTH)).map((cell) => cell.index),
    ])];
    for (const cell of pool) addTurn(turns, [cell], context);
  } else {
    const threatCells = opponentThreats.flatMap((threat) => threat.cells);
    const pool = [...new Set([
      ...threatCells,
      ...ranked.slice(0, QUIET_CELL_WIDTH).map((cell) => cell.index),
    ])];
    for (let first = 0; first < pool.length; first++) {
      for (let second = first + 1; second < pool.length; second++) {
        addTurn(turns, [pool[first], pool[second]], context);
      }
    }
    const scoreByCell = new Map(ranked.map((cell) => [cell.index, cell.score]));
    addSynergyPairs(context, color, scoreByCell, turns);
  }

  if (turns.size === 0) {
    addTurn(
      turns,
      ranked.slice(0, actualStones).map((cell) => cell.index),
      context,
    );
  }

  const scoreByCell = new Map(ranked.map((cell) => [cell.index, cell.score]));
  const options: TurnOption[] = [];
  for (const cells of turns.values()) {
    const quick = quickPositionScoreAfter(context, cells, color);
    const uncovered = opponentThreats.filter((threat) => !isThreatCovered(threat, cells)).length;
    const cellScore = cells.reduce((sum, cell) => sum + (scoreByCell.get(cell) ?? 0), 0);
    options.push({
      cells,
      quickScore: quick.score
        + quick.tacticalBonus
        + cellScore * 0.12
        + (quick.wins ? MATE_SCORE : 0)
        - uncovered * MATE_SCORE,
    });
  }

  return options.sort((a, b) =>
    b.quickScore - a.quickScore || compareTurns(a.cells, b.cells))
    .slice(0, width);
}

function chooseWinningTurn(
  context: PositionContext,
  color: Stone,
  stonesToPlace: number,
): number[] | null {
  const wins = collectWinningTurns(context, color, stonesToPlace);
  if (wins.length === 0) return null;

  return wins.map((win) => ({
    cells: win.cells,
    score: quickPositionScoreAfter(context, win.cells, color).score,
  })).sort((a, b) =>
    a.cells.length - b.cells.length
    || b.score - a.score
    || compareTurns(a.cells, b.cells))[0].cells;
}

function countEmpty(board: number[]): number {
  let count = 0;
  for (const stone of board) if (stone === Stone.EMPTY) count++;
  return count;
}

function hasExistingWin(context: PositionContext): boolean {
  return context.states.some((state) =>
    state.black >= context.config.winLength || state.white >= context.config.winLength);
}

function evaluateAfterReply(
  context: PositionContext,
  color: Stone,
  opponent: Stone,
): number {
  const ownWins = collectWinningTurns(context, color, 2);
  if (ownWins.length > 0) return MATE_SCORE + positionScore(context, color);

  const opponentThreats = collectWinningTurns(context, opponent, 2);
  if (
    opponentThreats.length > 0
    && enumerateThreatCovers(opponentThreats, Math.min(2, countEmpty(context.board))).length === 0
  ) {
    return -FORCED_SCORE + positionScore(context, color);
  }

  const singleThreats = opponentThreats.filter((threat) => threat.cells.length === 1).length;
  const pairThreats = opponentThreats.length - singleThreats;
  return positionScore(context, color)
    - singleThreats * 4_000_000
    - pairThreats * 320_000;
}

function chooseBestTurn(
  context: PositionContext,
  color: Stone,
  stonesToPlace: number,
): number[] | null {
  const winningTurn = chooseWinningTurn(context, color, stonesToPlace);
  if (winningTurn) return winningTurn;

  const opponent = opposite(color);
  const candidates = generateTurnCandidates(
    context,
    color,
    stonesToPlace,
    ROOT_TURN_WIDTH,
  );
  if (candidates.length === 0) return null;

  const roots: RootOption[] = candidates.map((candidate) => {
    const next = applyCells(context, candidate.cells, color);
    const opponentWins = collectWinningTurns(next, opponent, 2);
    const ownThreats = collectWinningTurns(next, color, 2);
    return {
      ...candidate,
      context: next,
      opponentWins,
      ownThreats,
      forcedNext: opponentWins.length === 0
        && ownThreats.length > 0
        && enumerateThreatCovers(
          ownThreats,
          Math.min(2, countEmpty(next.board)),
        ).length === 0,
    };
  });

  const safeRoots = roots.filter((root) => root.opponentWins.length === 0);
  const pool = safeRoots.length > 0 ? safeRoots : roots;
  pool.sort((a, b) => {
    if (a.forcedNext !== b.forcedNext) return a.forcedNext ? -1 : 1;
    const byOpponentWins = a.opponentWins.length - b.opponentWins.length;
    return byOpponentWins !== 0
      ? byOpponentWins
      : b.quickScore - a.quickScore || compareTurns(a.cells, b.cells);
  });

  if (pool[0].forcedNext) return pool[0].cells;
  if (safeRoots.length === 0) return pool[0].cells;

  let best = pool[0];
  let bestValue = -Infinity;
  for (const root of pool.slice(0, ROOT_SEARCH_WIDTH)) {
    const replies = generateTurnCandidates(
      root.context,
      opponent,
      Math.min(2, countEmpty(root.context.board)),
      REPLY_TURN_WIDTH,
    );
    let worstReply = positionScore(root.context, color);

    if (replies.length > 0) {
      worstReply = Infinity;
      for (const reply of replies.slice(0, REPLY_SEARCH_WIDTH)) {
        const afterReply = applyCells(root.context, reply.cells, opponent);
        const value = evaluateAfterReply(afterReply, color, opponent);
        worstReply = Math.min(worstReply, value);
      }
    }

    const value = worstReply + root.quickScore * 0.01;
    if (
      value > bestValue
      || (value === bestValue && compareTurns(root.cells, best.cells) < 0)
    ) {
      bestValue = value;
      best = root;
    }
  }

  return best.cells;
}

function validConfig(config: BoardConfig): boolean {
  return Number.isInteger(config.sizeX) && config.sizeX > 0
    && Number.isInteger(config.sizeY) && config.sizeY > 0
    && Number.isInteger(config.sizeZ) && config.sizeZ > 0
    && Number.isInteger(config.winLength) && config.winLength >= 2;
}

function validBoard(board: number[], expectedSize: number): boolean {
  return board.length === expectedSize
    && board.every((stone) =>
      stone === Stone.EMPTY || stone === Stone.BLACK || stone === Stone.WHITE);
}

export function computeAiMove(request: AiRequestPayload): AiResponsePayload {
  const { board, config, aiColor, currentPlayer, stonesToPlace } = request;
  if (
    currentPlayer !== aiColor
    || (aiColor !== Player.BLACK && aiColor !== Player.WHITE)
    || !Number.isInteger(stonesToPlace)
    || stonesToPlace < 1
    || stonesToPlace > 2
    || !validConfig(config)
  ) {
    return { moves: [] };
  }

  const expectedSize = config.sizeX * config.sizeY * config.sizeZ;
  if (!validBoard(board, expectedSize)) return { moves: [] };
  const emptyCount = countEmpty(board);
  if (emptyCount === 0) return { moves: [] };

  const geometry = buildGeometry(config);
  if (geometry.windows.length === 0) return { moves: [] };
  const context = analyzeBoard([...board], config, geometry);
  if (hasExistingWin(context)) return { moves: [] };

  // The opening is intentionally fixed and color-neutral for reproducible play.
  if (emptyCount === board.length) {
    return {
      moves: [{
        x: Math.floor(config.sizeX / 2),
        y: Math.floor(config.sizeY / 2),
        z: Math.floor(config.sizeZ / 2),
      }],
    };
  }

  const color = aiColor as unknown as Stone;
  const cells = chooseBestTurn(
    context,
    color,
    Math.min(stonesToPlace, emptyCount),
  );
  return {
    moves: cells?.map((cell) => ({ ...geometry.positions[cell] })) ?? [],
  };
}

/** Highest exact line-window value for training analysis and diagnostics. */
export function scoreCell(
  board: number[],
  config: BoardConfig,
  x: number,
  y: number,
  z: number,
  color: Stone,
): number {
  if (
    !validConfig(config)
    || !inBounds(x, y, z, config)
    || (color !== Stone.BLACK && color !== Stone.WHITE)
  ) {
    return 0;
  }
  const expectedSize = config.sizeX * config.sizeY * config.sizeZ;
  if (!validBoard(board, expectedSize)) return 0;

  const geometry = buildGeometry(config);
  const cell = indexOf(x, y, z, config);
  if (board[cell] !== Stone.EMPTY) return 0;
  let best = 0;

  for (const windowIndex of geometry.windowsByCell[cell]) {
    let own = 1;
    let blocked = false;
    for (const member of geometry.windows[windowIndex].cells) {
      if (member === cell) continue;
      const stone = board[member];
      if (stone === color) own++;
      else if (stone !== Stone.EMPTY) {
        blocked = true;
        break;
      }
    }
    if (!blocked) best = Math.max(best, patternValue(own, config.winLength));
  }
  return best;
}
