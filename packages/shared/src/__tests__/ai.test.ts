import { describe, expect, it } from "vitest";
import { computeAiMove } from "../ai";
import { Connect6Engine } from "../engine";
import { Player, Stone, type AiRequestPayload, type BoardConfig, type Vec3 } from "../types";

const config: BoardConfig = { sizeX: 10, sizeY: 10, sizeZ: 10, winLength: 6 };

function indexOf({ x, y, z }: Vec3): number {
  return z * config.sizeY * config.sizeX + y * config.sizeX + x;
}

function request(board: number[], stonesToPlace: number): AiRequestPayload {
  return {
    board,
    config,
    aiColor: Player.BLACK,
    currentPlayer: Player.BLACK,
    stonesToPlace,
  };
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

  it("does not move for the other player", () => {
    const req = request(Array<number>(1000).fill(Stone.EMPTY), 1);
    req.currentPlayer = Player.WHITE;
    expect(computeAiMove(req).moves).toEqual([]);
  });
});
