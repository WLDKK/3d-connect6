import { describe, it, expect } from "vitest";
import { Connect6Engine } from "../engine";
import { Player, Stone } from "../types";

// Helper: place stones along a line and return the engine
function placeLine(
  engine: Connect6Engine,
  stones: { x: number; y: number; z: number }[],
): Connect6Engine {
  for (const s of stones) {
    engine.placeStone(s.x, s.y, s.z);
  }
  return engine;
}

describe("Connect6Engine", () => {
  // ─── Initialization ───

  it("initializes with empty 10x10x10 board", () => {
    const engine = new Connect6Engine();
    expect(engine.config.sizeX).toBe(10);
    expect(engine.config.sizeY).toBe(10);
    expect(engine.config.sizeZ).toBe(10);
    expect(engine.state.currentPlayer).toBe(Player.BLACK);
    expect(engine.state.round).toBe(0);
    expect(engine.state.winner).toBe(Stone.EMPTY);
    expect(engine.state.board.length).toBe(1000);
    expect(engine.state.board.every((s) => s === Stone.EMPTY)).toBe(true);
  });

  // ─── Round 0: single stone ───

  it("round 0: black places exactly 1 stone, then white goes", () => {
    const engine = new Connect6Engine();
    expect(engine.placeStone(0, 0, 0)).toBe(true);
    expect(engine.state.currentPlayer).toBe(Player.WHITE);
    expect(engine.state.round).toBe(1);
    expect(engine.state.stonesPlacedThisTurn).toBe(0);
    expect(engine.getStone(0, 0, 0)).toBe(Stone.BLACK);
  });

  it("round 0: black cannot place 2 stones", () => {
    const engine = new Connect6Engine();
    engine.placeStone(0, 0, 0);
    // Now it's white's turn (round 1), black can't place
    expect(engine.placeStone(1, 0, 0)).toBe(true); // white's first stone
    expect(engine.state.currentPlayer).toBe(Player.WHITE); // still white
  });

  // ─── Normal rounds: 2 stones per turn ───

  it("normal rounds: each player places 2 stones", () => {
    const engine = new Connect6Engine();
    // Round 0: black places 1
    engine.placeStone(0, 0, 0);
    // Round 1: white places 2
    expect(engine.state.currentPlayer).toBe(Player.WHITE);
    engine.placeStone(1, 0, 0);
    expect(engine.state.currentPlayer).toBe(Player.WHITE); // still white
    engine.placeStone(2, 0, 0);
    expect(engine.state.currentPlayer).toBe(Player.BLACK); // now black
    expect(engine.state.round).toBe(2);
  });

  // ─── Illegal moves ───

  it("rejects out-of-bounds moves", () => {
    const engine = new Connect6Engine();
    expect(engine.placeStone(-1, 0, 0)).toBe(false);
    expect(engine.placeStone(10, 0, 0)).toBe(false);
    expect(engine.placeStone(0, 11, 0)).toBe(false);
  });

  it("rejects placing on occupied cell", () => {
    const engine = new Connect6Engine();
    engine.placeStone(0, 0, 0);
    // It's now white's turn, try same cell
    expect(engine.placeStone(0, 0, 0)).toBe(false);
  });

  it("rejects moves after game is won", () => {
    const engine = new Connect6Engine({ sizeX: 6, sizeY: 6, sizeZ: 6, winLength: 1 });
    engine.placeStone(0, 0, 0); // instant win
    expect(engine.state.winner).toBe(Player.BLACK);
    expect(engine.placeStone(1, 0, 0)).toBe(false);
  });

  // ─── Win detection: X axis ───

  it("detects win on X axis — full game flow", () => {
    // 10x10x10 board, white scatters randomly
    const engine = new Connect6Engine({
      sizeX: 10, sizeY: 10, sizeZ: 10, winLength: 6,
    });
    // Round 0: B(0,0,0)
    engine.placeStone(0, 0, 0);
    // Round 1: W scatters far apart
    engine.placeStone(9, 9, 9);
    engine.placeStone(8, 9, 9);
    // Round 2: B
    engine.placeStone(1, 0, 0);
    engine.placeStone(2, 0, 0);
    // Round 3: W scatters
    engine.placeStone(7, 9, 9);
    engine.placeStone(6, 9, 9);
    // Round 4: B
    engine.placeStone(3, 0, 0);
    engine.placeStone(4, 0, 0);
    // Round 5: W scatters
    engine.placeStone(5, 9, 9);
    engine.placeStone(9, 8, 9);
    // Round 6: B(5,0,0) — 6th black stone on X axis!
    expect(engine.state.currentPlayer).toBe(Player.BLACK);
    expect(engine.state.round).toBe(6);
    const placed = engine.placeStone(5, 0, 0);
    expect(placed).toBe(true);
    expect(engine.getStone(5, 0, 0)).toBe(Stone.BLACK);
    expect(engine.state.winner).toBe(Player.BLACK);
  });

  // ─── Win detection: direct board setup ───

  function makeEngineWithBoard(
    size: number,
    winLength: number,
    setup: (engine: Connect6Engine) => void,
  ): Connect6Engine {
    const engine = new Connect6Engine({
      sizeX: size, sizeY: size, sizeZ: size, winLength,
    });
    setup(engine);
    return engine;
  }

  it("detects 6-in-a-row on X axis", () => {
    const engine = makeEngineWithBoard(8, 6, () => {});
    // Directly set board: black stones at x=0..5, y=0, z=0
    for (let x = 0; x < 6; x++) {
      engine.state.board[engine.idx(x, 0, 0)] = Stone.BLACK;
    }
    expect(engine.checkWin(3, 0, 0)).toBe(true); // middle of the line
    expect(engine.checkWin(0, 0, 0)).toBe(true); // end of the line
    expect(engine.checkWin(5, 0, 0)).toBe(true); // other end
  });

  it("detects 6-in-a-row on Y axis", () => {
    const engine = makeEngineWithBoard(8, 6, () => {});
    for (let y = 0; y < 6; y++) {
      engine.state.board[engine.idx(0, y, 0)] = Stone.WHITE;
    }
    expect(engine.checkWin(0, 3, 0)).toBe(true);
  });

  it("detects 6-in-a-row on Z axis", () => {
    const engine = makeEngineWithBoard(8, 6, () => {});
    for (let z = 0; z < 6; z++) {
      engine.state.board[engine.idx(0, 0, z)] = Stone.BLACK;
    }
    expect(engine.checkWin(0, 0, 2)).toBe(true);
  });

  it("detects 6-in-a-row on XY diagonal (1,1,0)", () => {
    const engine = makeEngineWithBoard(8, 6, () => {});
    for (let i = 0; i < 6; i++) {
      engine.state.board[engine.idx(i, i, 0)] = Stone.BLACK;
    }
    expect(engine.checkWin(3, 3, 0)).toBe(true);
  });

  it("detects 6-in-a-row on XY diagonal (1,-1,0)", () => {
    const engine = makeEngineWithBoard(8, 6, () => {});
    for (let i = 0; i < 6; i++) {
      engine.state.board[engine.idx(i, 5 - i, 0)] = Stone.WHITE;
    }
    expect(engine.checkWin(2, 3, 0)).toBe(true);
  });

  it("detects 6-in-a-row on XZ diagonal (1,0,1)", () => {
    const engine = makeEngineWithBoard(8, 6, () => {});
    for (let i = 0; i < 6; i++) {
      engine.state.board[engine.idx(i, 0, i)] = Stone.BLACK;
    }
    expect(engine.checkWin(4, 0, 4)).toBe(true);
  });

  it("detects 6-in-a-row on YZ diagonal (0,1,1)", () => {
    const engine = makeEngineWithBoard(8, 6, () => {});
    for (let i = 0; i < 6; i++) {
      engine.state.board[engine.idx(0, i, i)] = Stone.WHITE;
    }
    expect(engine.checkWin(0, 2, 2)).toBe(true);
  });

  it("detects 6-in-a-row on space diagonal (1,1,1)", () => {
    const engine = makeEngineWithBoard(8, 6, () => {});
    for (let i = 0; i < 6; i++) {
      engine.state.board[engine.idx(i, i, i)] = Stone.BLACK;
    }
    expect(engine.checkWin(3, 3, 3)).toBe(true);
  });

  it("detects 6-in-a-row on space diagonal (1,1,-1)", () => {
    const engine = makeEngineWithBoard(8, 6, () => {});
    for (let i = 0; i < 6; i++) {
      engine.state.board[engine.idx(i, i, 5 - i)] = Stone.WHITE;
    }
    expect(engine.checkWin(2, 2, 3)).toBe(true);
  });

  it("detects 6-in-a-row on space diagonal (1,-1,1)", () => {
    const engine = makeEngineWithBoard(8, 6, () => {});
    for (let i = 0; i < 6; i++) {
      engine.state.board[engine.idx(i, 5 - i, i)] = Stone.BLACK;
    }
    expect(engine.checkWin(1, 4, 1)).toBe(true);
  });

  it("detects 6-in-a-row on space diagonal (1,-1,-1)", () => {
    const engine = makeEngineWithBoard(8, 6, () => {});
    for (let i = 0; i < 6; i++) {
      engine.state.board[engine.idx(i, 5 - i, 5 - i)] = Stone.WHITE;
    }
    expect(engine.checkWin(0, 5, 5)).toBe(true);
  });

  // ─── No false positives ───

  it("does NOT detect win with only 5 in a row", () => {
    const engine = makeEngineWithBoard(8, 6, () => {});
    for (let x = 0; x < 5; x++) {
      engine.state.board[engine.idx(x, 0, 0)] = Stone.BLACK;
    }
    expect(engine.checkWin(2, 0, 0)).toBe(false);
  });

  it("does NOT detect win when line is blocked by opponent", () => {
    const engine = makeEngineWithBoard(8, 6, () => {});
    // B B B B _ B with white stone in the gap
    for (let x = 0; x < 6; x++) {
      engine.state.board[engine.idx(x, 0, 0)] = Stone.BLACK;
    }
    engine.state.board[engine.idx(4, 0, 0)] = Stone.WHITE; // block
    expect(engine.checkWin(2, 0, 0)).toBe(false);
  });

  it("does NOT detect win on empty board", () => {
    const engine = new Connect6Engine();
    expect(engine.checkWin(0, 0, 0)).toBe(false);
  });

  // ─── Snapshot serialization ───

  it("serializes and deserializes correctly", () => {
    const engine = new Connect6Engine();
    engine.placeStone(1, 2, 3);
    engine.placeStone(4, 5, 0);
    engine.placeStone(0, 0, 0);

    const json = engine.toJSON();
    const restored = Connect6Engine.fromJSON(json);

    expect(restored.state.currentPlayer).toBe(engine.state.currentPlayer);
    expect(restored.state.round).toBe(engine.state.round);
    expect(restored.state.stonesPlacedThisTurn).toBe(engine.state.stonesPlacedThisTurn);
    expect(restored.state.winner).toBe(engine.state.winner);
    expect(Array.from(restored.state.board)).toEqual(Array.from(engine.state.board));
    expect(restored.getStone(1, 2, 3)).toBe(Stone.BLACK);
    expect(restored.getStone(4, 5, 0)).toBe(Stone.WHITE);
  });

  // ─── Full game flow ───

  it("plays a full game to win on 6x6x6 board (X axis)", () => {
    const engine = new Connect6Engine();
    // Round 0: B places (0,0,0)
    engine.placeStone(0, 0, 0);
    // Round 1: W scatters (no line possible)
    engine.placeStone(0, 5, 5);
    engine.placeStone(5, 0, 5);
    // Round 2: B places (1,0,0), (2,0,0)
    engine.placeStone(1, 0, 0);
    engine.placeStone(2, 0, 0);
    // Round 3: W scatters
    engine.placeStone(5, 5, 0);
    engine.placeStone(0, 0, 5);
    // Round 4: B places (3,0,0), (4,0,0)
    engine.placeStone(3, 0, 0);
    engine.placeStone(4, 0, 0);
    // Round 5: W scatters
    engine.placeStone(5, 5, 5);
    engine.placeStone(2, 3, 4);
    // Round 6: B places (5,0,0) — 6th black stone on X!
    expect(engine.state.currentPlayer).toBe(Player.BLACK);
    expect(engine.state.round).toBe(6);
    const placed = engine.placeStone(5, 0, 0);
    expect(placed).toBe(true);
    expect(engine.getStone(5, 0, 0)).toBe(Stone.BLACK);
    expect(engine.state.winner).toBe(Player.BLACK);
  });
});
