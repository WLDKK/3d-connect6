import { describe, expect, it } from "vitest";
import { computeAiMove } from "../ai";
import { Connect6Engine } from "../engine";
import { Player, Stone, type AiRequestPayload, type BoardConfig, type Vec3 } from "../types";

const config: BoardConfig = { sizeX: 10, sizeY: 10, sizeZ: 10, winLength: 6 };

function indexOf({ x, y, z }: Vec3): number {
  return z * config.sizeY * config.sizeX + y * config.sizeX + x;
}

function request(
  board: number[],
  stonesToPlace: number,
  aiColor: Player = Player.BLACK,
): AiRequestPayload {
  return {
    board,
    config,
    aiColor,
    currentPlayer: aiColor,
    stonesToPlace,
  };
}

function key(move: Vec3): string {
  return `${move.x},${move.y},${move.z}`;
}

describe("pair-aware local AI", () => {
  it("opens at the deterministic 3D center", () => {
    const result = computeAiMove(request(Array<number>(1000).fill(Stone.EMPTY), 1));
    expect(result.moves).toEqual([{ x: 5, y: 5, z: 5 }]);
  });

  it("uses both stones to block both ends of an immediate open-five", () => {
    const board = Array<number>(1000).fill(Stone.EMPTY);
    for (let x = 2; x <= 6; x++) board[indexOf({ x, y: 5, z: 5 })] = Stone.WHITE;

    const result = computeAiMove(request(board, 2));
    const keys = new Set(result.moves.map((move) => `${move.x},${move.y},${move.z}`));

    expect(result.moves).toHaveLength(2);
    expect(keys).toEqual(new Set(["1,5,5", "7,5,5"]));
  });

  it("finds a two-stone completion that wins within the current turn", () => {
    const board = Array<number>(1000).fill(Stone.EMPTY);
    for (let x = 2; x <= 5; x++) board[indexOf({ x, y: 4, z: 4 })] = Stone.BLACK;

    const result = computeAiMove(request(board, 2));
    const engine = new Connect6Engine(config);
    engine.state.board.set(board);
    for (const move of result.moves) {
      engine.state.board[engine.idx(move.x, move.y, move.z)] = Stone.BLACK;
    }

    expect(result.moves).toHaveLength(2);
    const last = result.moves.at(-1)!;
    expect(engine.checkWin(last.x, last.y, last.z)).toBe(true);
  });

  it("blocks both ends of an immediate space-diagonal threat", () => {
    const board = Array<number>(1000).fill(Stone.EMPTY);
    for (let n = 2; n <= 6; n++) board[indexOf({ x: n, y: n, z: n })] = Stone.WHITE;

    const result = computeAiMove(request(board, 2));
    const keys = new Set(result.moves.map((move) => `${move.x},${move.y},${move.z}`));

    expect(keys).toEqual(new Set(["1,1,1", "7,7,7"]));
  });

  it("recognizes and closes a broken-line winning gap", () => {
    const board = Array<number>(1000).fill(Stone.EMPTY);
    for (const x of [1, 2, 3, 5, 6]) board[indexOf({ x, y: 3, z: 7 })] = Stone.BLACK;

    const result = computeAiMove(request(board, 1));
    expect(result.moves).toEqual([{ x: 4, y: 3, z: 7 }]);
  });

  it("blocks both sides of a four-stone line before the opponent can finish with two", () => {
    const board = Array<number>(1000).fill(Stone.EMPTY);
    for (let x = 2; x <= 5; x++) board[indexOf({ x, y: 6, z: 3 })] = Stone.WHITE;

    const result = computeAiMove(request(board, 2));
    expect(new Set(result.moves.map(key))).toEqual(new Set(["1,6,3", "6,6,3"]));
  });

  it("covers two independent boundary pair threats in the same turn", () => {
    const board = Array<number>(1000).fill(Stone.EMPTY);
    for (let x = 0; x <= 3; x++) board[indexOf({ x, y: 1, z: 1 })] = Stone.WHITE;
    for (let y = 0; y <= 3; y++) board[indexOf({ x: 8, y, z: 8 })] = Stone.WHITE;

    const result = computeAiMove(request(board, 2));
    const moves = new Set(result.moves.map(key));

    expect(result.moves).toHaveLength(2);
    expect(["4,1,1", "5,1,1"].some((cell) => moves.has(cell))).toBe(true);
    expect(["8,4,8", "8,5,8"].some((cell) => moves.has(cell))).toBe(true);
  });

  it("uses a shared blocking cell to neutralize intersecting pair threats", () => {
    const board = Array<number>(1000).fill(Stone.EMPTY);
    for (let x = 0; x <= 3; x++) board[indexOf({ x, y: 4, z: 4 })] = Stone.WHITE;
    for (let y = 0; y <= 3; y++) board[indexOf({ x: 4, y, z: 4 })] = Stone.WHITE;

    const result = computeAiMove(request(board, 2));
    expect(result.moves.map(key)).toContain("4,4,4");
  });

  it("finds a legal one-stone cover when only one placement remains", () => {
    const board = Array<number>(1000).fill(Stone.EMPTY);
    for (let x = 0; x <= 3; x++) board[indexOf({ x, y: 2, z: 9 })] = Stone.WHITE;

    const result = computeAiMove(request(board, 1));
    expect(result.moves).toHaveLength(1);
    expect(["4,2,9", "5,2,9"]).toContain(key(result.moves[0]));
  });

  it("returns deterministic, distinct and legal pair moves", () => {
    const board = Array<number>(1000).fill(Stone.EMPTY);
    board[indexOf({ x: 5, y: 5, z: 5 })] = Stone.BLACK;
    board[indexOf({ x: 4, y: 5, z: 5 })] = Stone.WHITE;
    board[indexOf({ x: 5, y: 4, z: 5 })] = Stone.BLACK;
    board[indexOf({ x: 5, y: 5, z: 4 })] = Stone.WHITE;

    const first = computeAiMove(request(board, 2));
    const second = computeAiMove(request(board, 2));

    expect(second).toEqual(first);
    expect(first.moves).toHaveLength(2);
    expect(new Set(first.moves.map((move) => indexOf(move))).size).toBe(2);
    expect(first.moves.every((move) => board[indexOf(move)] === Stone.EMPTY)).toBe(true);
  }, 5_000);

  it("is color-symmetric for the same tactical position", () => {
    const blackBoard = Array<number>(1000).fill(Stone.EMPTY);
    const whiteBoard = Array<number>(1000).fill(Stone.EMPTY);
    for (let x = 2; x <= 5; x++) {
      blackBoard[indexOf({ x, y: 7, z: 2 })] = Stone.BLACK;
      whiteBoard[indexOf({ x, y: 7, z: 2 })] = Stone.WHITE;
    }
    blackBoard[indexOf({ x: 5, y: 5, z: 5 })] = Stone.WHITE;
    whiteBoard[indexOf({ x: 5, y: 5, z: 5 })] = Stone.BLACK;

    const black = computeAiMove(request(blackBoard, 2, Player.BLACK));
    const white = computeAiMove(request(whiteBoard, 2, Player.WHITE));
    expect(white).toEqual(black);
  });

  it("never mutates the caller's board", () => {
    const board = Array<number>(1000).fill(Stone.EMPTY);
    board[indexOf({ x: 5, y: 5, z: 5 })] = Stone.BLACK;
    board[indexOf({ x: 4, y: 5, z: 5 })] = Stone.WHITE;
    const before = [...board];

    computeAiMove(request(board, 2));
    expect(board).toEqual(before);
  });

  it("stays within the worker budget on a representative midgame", () => {
    const board = Array<number>(1000).fill(Stone.EMPTY);
    const stones: Array<[Vec3, Stone]> = [
      [{ x: 5, y: 5, z: 5 }, Stone.BLACK],
      [{ x: 4, y: 5, z: 5 }, Stone.WHITE],
      [{ x: 5, y: 4, z: 5 }, Stone.BLACK],
      [{ x: 5, y: 5, z: 4 }, Stone.WHITE],
      [{ x: 6, y: 5, z: 5 }, Stone.BLACK],
      [{ x: 3, y: 5, z: 5 }, Stone.WHITE],
      [{ x: 5, y: 6, z: 5 }, Stone.BLACK],
      [{ x: 5, y: 5, z: 6 }, Stone.WHITE],
      [{ x: 6, y: 6, z: 5 }, Stone.BLACK],
      [{ x: 4, y: 4, z: 5 }, Stone.WHITE],
      [{ x: 6, y: 5, z: 6 }, Stone.BLACK],
      [{ x: 4, y: 5, z: 4 }, Stone.WHITE],
    ];
    for (const [position, stone] of stones) board[indexOf(position)] = stone;

    const started = Date.now();
    const result = computeAiMove(request(board, 2));
    const elapsed = Date.now() - started;

    expect(result.moves).toHaveLength(2);
    expect(elapsed).toBeLessThan(2_500);
  }, 5_000);

  it("rejects malformed boards and already-finished positions", () => {
    expect(computeAiMove(request([Stone.EMPTY], 1)).moves).toEqual([]);

    const board = Array<number>(1000).fill(Stone.EMPTY);
    for (let x = 1; x <= 6; x++) board[indexOf({ x, y: 8, z: 8 })] = Stone.BLACK;
    expect(computeAiMove(request(board, 2)).moves).toEqual([]);
  });

  it("does not move for the other player", () => {
    const req = request(Array<number>(1000).fill(Stone.EMPTY), 1);
    req.currentPlayer = Player.WHITE;
    expect(computeAiMove(req).moves).toEqual([]);
  });
});
