import {
  computeAiMove,
  scoreCell,
  type AiRequestPayload,
  type AiResponsePayload,
  type AiModelId,
  type BoardConfig,
  Stone, Player,
} from "@connect6/shared";

/**
 * LLM-powered AI service with multi-model support.
 * Falls back to Dummy AI (greedy defense) on any failure.
 */

/** API key — read from env (wrangler secret) or fallback for local dev */
let LLM_API_KEY = "ak-a441b4719add46ae930f0246782c22d0";
const LLM_TIMEOUT_MS = 120000; // 2 minutes

/** Inject API key from Worker env (call once at startup) */
export function setAiApiKey(key: string) {
  LLM_API_KEY = key;
}

/** Model endpoint configuration */
interface ModelConfig {
  url: string;
  model: string;
  protocol: "openai" | "anthropic";
}

const MODEL_ENDPOINTS: Record<Exclude<AiModelId, "local">, ModelConfig> = {
  "qwen3.6-plus": {
    url: "https://agent.nuwax.com/api/proxy/model/1/v1/chat/completions",
    model: "qwen3.6-plus",
    protocol: "openai",
  },
  "qwen3.7-max": {
    url: "https://agent.nuwax.com/api/proxy/model/298049/v1/messages",
    model: "qwen3.7-max",
    protocol: "anthropic",
  },
  "deepseek-v4-flash": {
    url: "https://agent.nuwax.com/api/proxy/model/294558/v1/messages",
    model: "deepseek-v4-flash",
    protocol: "anthropic",
  },
  "glm-5.1": {
    url: "https://agent.nuwax.com/api/proxy/model/297238/v1/messages",
    model: "glm-5.1",
    protocol: "anthropic",
  },
};

function stoneChar(stone: Stone): string {
  if (stone === Stone.BLACK) return "X";
  if (stone === Stone.WHITE) return "O";
  return ".";
}

function buildBoardText(board: number[], sx: number, sy: number, sz: number): string {
  const layers: string[] = [];
  for (let z = 0; z < sz; z++) {
    const lines: string[] = [`--- Layer Z=${z} ---`];
    lines.push("    " + Array.from({ length: sx }, (_, i) => String(i).padStart(2)).join(" "));
    for (let y = 0; y < sy; y++) {
      const row = Array.from({ length: sx }, (_, x) =>
        stoneChar(board[z * sy * sx + y * sx + x] as Stone),
      ).join("  ");
      lines.push(`Y=${y}: ${row}`);
    }
    layers.push(lines.join("\n"));
  }
  return layers.join("\n\n");
}

function parseMovesFromText(text: string, count: number): { x: number; y: number; z: number }[] {
  const moves: { x: number; y: number; z: number }[] = [];
  const regex = /\(?\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)?/g;
  let match;
  while ((match = regex.exec(text)) !== null && moves.length < count) {
    moves.push({
      x: parseInt(match[1], 10),
      y: parseInt(match[2], 10),
      z: parseInt(match[3], 10),
    });
  }
  return moves;
}

function validateMoves(
  moves: { x: number; y: number; z: number }[],
  board: number[],
  sx: number, sy: number, sz: number,
): { x: number; y: number; z: number }[] {
  return moves.filter(m => {
    if (m.x < 0 || m.x >= sx || m.y < 0 || m.y >= sy || m.z < 0 || m.z >= sz) return false;
    return board[m.z * sy * sx + m.y * sx + m.x] === Stone.EMPTY;
  });
}

/** Build the system + user prompts for any model */
function buildPrompts(req: AiRequestPayload) {
  const { board, config, aiColor, stonesToPlace } = req;
  const { sizeX: sx, sizeY: sy, sizeZ: sz, winLength } = config;
  const colorName = aiColor === Player.BLACK ? "Black (X)" : "White (O)";
  const oppName = aiColor === Player.BLACK ? "White (O)" : "Black (X)";
  const boardText = buildBoardText(board, sx, sy, sz);

  let blackCount = 0, whiteCount = 0;
  for (const s of board) {
    if (s === Stone.BLACK) blackCount++;
    if (s === Stone.WHITE) whiteCount++;
  }

  const analysis = analyzePosition(board, config, aiColor as unknown as Stone);

  const system = `You are a world-class Connect6 AI grandmaster. Board: ${sx}×${sy}×${sz} (3D). You are ${colorName}.

═══ RULES ═══
- 3D grid: (x, y, z), each 0..${sx - 1}.
- Round 0: Black places 1 stone. All later rounds: current player places 2 stones.
- WIN: ${winLength} in a straight line (any of 13 directions: 3 axes + 6 face diagonals + 4 space diagonals).
- Place only on empty cells (".").
- Lines extend in ALL 3 dimensions — don't forget Z-axis diagonals!

═══ LINE TYPES ═══
- "Open-N": N same-color stones in a row, BOTH ends empty → unstoppable if N ≥ ${winLength - 1} with 2 stones/turn.
- "Half-open-N": N stones, one end blocked → can be blocked.
- "Closed": both ends blocked → dead line, ignore.

═══ STRATEGY (Connect6 is NOT Go — defense alone loses!) ═══

Priority 1 — WIN NOW:
  If you can complete ${winLength} in a row, do it. No discussion.

Priority 2 — BLOCK UNSTOPPABLE THREATS:
  If opponent has an Open-${winLength - 1}, you MUST block one end this turn.
  If opponent has TWO Open-${winLength - 1}s, you can only block one → you're losing, try to create your own counter-threat.

Priority 3 — CREATE DOUBLE THREATS (the key to winning):
  Place your 2 stones to create TWO separate Open-${winLength - 1} lines simultaneously.
  Opponent can block only one per turn → you win next turn.
  This is the PRIMARY winning mechanism in Connect6.

Priority 4 — BUILD OPEN LINES:
  An Open-4 (4 in a row, both ends empty) is a winning threat — opponent MUST respond.
  An Open-3 is strong — grows to Open-4 if unblocked.
  Prioritize lines that are OPEN over half-open.

Priority 5 — CONTROL THE CENTER:
  Center cells (x≈${Math.floor(sx / 2)}, y≈${Math.floor(sy / 2)}, z≈${Math.floor(sz / 2)}) participate in more line directions.
  Edge/corner cells are weaker — fewer directions to build lines.

Priority 6 — USE BOTH STONES WISELY:
  With 2 stones per turn, you can:
  a) Extend one line (e.g., turn Open-3 into Open-5)
  b) Create two separate threats (double threat — best)
  c) Block one threat + build your own line
  NEVER waste a stone on a dead-end position.

═══ WHAT TO AVOID ═══
- Placing isolated stones far from any line — wastes a turn.
- Extending a half-open line when you could build a new open line.
- Ignoring Z-axis lines — the board is 3D, diagonal through layers is powerful.
- Defensive-only play — you MUST attack, 2 stones/turn means pure defense loses.

═══ 3D DIAGONALS (often overlooked!) ═══
The 4 space diagonals are the most powerful directions:
- (1,1,1): from corner to corner through the cube
- (1,1,-1): diagonal through XY plane going down in Z
- (1,-1,1): diagonal through XZ plane
- (1,-1,-1): opposite corner diagonal
These are HARD to block because opponents often forget about them.
If you can build an open line along a space diagonal, it's extremely dangerous.

═══ DOUBLE THREAT PATTERNS ═══
The winning pattern in Connect6 is ALWAYS a double threat:
- Place stone A to create Open-4 along direction D1
- Place stone B to create Open-4 along direction D2
- Opponent blocks one → you complete the other → WIN
Look for cells where a single stone creates multiple open lines simultaneously.
A cell at the intersection of two different directions is a "fork" opportunity.`;

  const user = `Board state (X=Black, O=White, .=empty). You are ${colorName}, place ${stonesToPlace} stone(s).
Black: ${blackCount} stones, White: ${whiteCount} stones.

${boardText}
${analysis}

═══ THINK DEEPLY ═══
Before moving, analyze the position step by step:

1. **Scan for immediate wins**: Can I complete ${winLength} in a row this turn? Check all 13 directions from every empty cell.

2. **Scan for opponent threats**: Does the opponent have any Open-${winLength - 1} or winning moves I MUST block?

3. **Evaluate candidate moves**: For the top 5-8 candidate positions, assess:
   - What lines does this stone extend or create?
   - Is the resulting line open, half-open, or closed?
   - Does this stone participate in multiple line directions?
   - Does this create a double-threat opportunity?

4. **Plan both stones together**: Since I place ${stonesToPlace} stone(s), how do they work as a team?
   - Can they create two separate Open-${winLength - 1} lines?
   - Can one block while the other attacks?

5. **Choose the BEST move**: Select the move(s) that maximize winning chances.

After your analysis, output ONLY the final coordinates on the last line:
Format: (x,y,z) or (x1,y1,z1) (x2,y2,z2)`;

  return { system, user };
}

/**
 * Analyze the position and return strategic context for the LLM.
 */
function analyzePosition(board: number[], config: BoardConfig, aiStone: Stone): string {
  const { sizeX: sx, sizeY: sy, sizeZ: sz, winLength } = config;
  const oppStone = aiStone === Stone.BLACK ? Stone.WHITE : Stone.BLACK;
  const lines: string[] = [];

  let myWins = 0, oppWins = 0;
  let myOpen5 = 0, oppOpen5 = 0;
  let myOpen4 = 0, oppOpen4 = 0;
  const myWinMoves: string[] = [];
  const oppWinMoves: string[] = [];
  const myOpen5Moves: string[] = [];
  const oppOpen5Moves: string[] = [];

  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        if (board[z * sy * sx + y * sx + x] !== Stone.EMPTY) continue;

        // scoreCell returns line scores: 500000=win, 50000=open-5, 1200=open-4, 100=open-3
        const myScore = scoreCell(board, config, x, y, z, aiStone);
        const oppScore = scoreCell(board, config, x, y, z, oppStone);

        if (myScore >= 500000) { myWins++; myWinMoves.push(`(${x},${y},${z})`); }
        if (oppScore >= 500000) { oppWins++; oppWinMoves.push(`(${x},${y},${z})`); }
        if (myScore >= 50000 && myScore < 500000) { myOpen5++; myOpen5Moves.push(`(${x},${y},${z})`); }
        if (oppScore >= 50000 && oppScore < 500000) { oppOpen5++; oppOpen5Moves.push(`(${x},${y},${z})`); }
        if (myScore >= 1200 && myScore < 50000) myOpen4++;
        if (oppScore >= 1200 && oppScore < 50000) oppOpen4++;
      }
    }
  }

  if (oppWins > 0) lines.push(`🚨 CRITICAL: Opponent can win at ${oppWinMoves.join(", ")} — YOU MUST BLOCK ONE!`);
  if (myWins > 0) lines.push(`✅ YOU CAN WIN at ${myWinMoves.join(", ")} — play it now!`);
  if (oppOpen5 > 0) lines.push(`⚠️ Opponent Open-${winLength - 1} at ${oppOpen5Moves.slice(0, 3).join(", ")}${oppOpen5 > 3 ? "..." : ""} — block urgently.`);
  if (myOpen5 > 0) lines.push(`🎯 Your Open-${winLength - 1} at ${myOpen5Moves.slice(0, 3).join(", ")}${myOpen5 > 3 ? "..." : ""} — press the advantage.`);
  if (myOpen4 > 1) lines.push(`💪 You have ${myOpen4} Open-${winLength - 2} lines — look for double-threat setups.`);
  if (oppOpen4 > 1) lines.push(`🛡️ Opponent has ${oppOpen4} Open-${winLength - 2} — watch for their double threats.`);

  if (lines.length === 0) {
    lines.push("📋 No immediate threats. Focus on building open lines toward the center.");
  }

  return "\n" + lines.join("\n");
}

/** Call using OpenAI-compatible protocol */
async function callOpenAI(cfg: ModelConfig, system: string, user: string, signal?: AbortSignal): Promise<string | null> {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LLM_API_KEY}`,
    },
    signal,
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 16384,
      temperature: 0.15,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? null;
}

/** Call using Anthropic protocol */
async function callAnthropic(cfg: ModelConfig, system: string, user: string, signal?: AbortSignal): Promise<string | null> {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": LLM_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    signal,
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 16384,
      temperature: 0.15,
      system,
      messages: [
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as {
    content?: { type: string; text: string }[];
  };
  const textBlock = data.content?.find(b => b.type === "text");
  return textBlock?.text ?? null;
}

/**
 * Call LLM and parse moves.
 * Returns null on any failure.
 */
async function callLLM(req: AiRequestPayload): Promise<{ x: number; y: number; z: number }[] | null> {
  const modelId = req.model ?? "local";
  if (modelId === "local") return null;

  const cfg = MODEL_ENDPOINTS[modelId];
  if (!cfg) {
    console.log(`[AI] Unknown model: ${modelId}`);
    return null;
  }

  const { system, user } = buildPrompts(req);

  try {
    console.log(`[AI] Calling ${modelId} (${cfg.protocol})...`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    const text = cfg.protocol === "openai"
      ? await callOpenAI(cfg, system, user, controller.signal)
      : await callAnthropic(cfg, system, user, controller.signal);

    clearTimeout(timer);
    console.log(`[AI] LLM response: ${text?.slice(0, 100)}`);

    if (!text) return null;

    const parsed = parseMovesFromText(text, req.stonesToPlace);
    const validated = validateMoves(parsed, req.board, req.config.sizeX, req.config.sizeY, req.config.sizeZ);
    console.log(`[AI] Parsed ${parsed.length} moves, validated ${validated.length}`);
    return validated;
  } catch (e) {
    console.log(`[AI] Error: ${e}`);
    return null;
  }
}

/**
 * Compute AI move: try LLM first, fall back to local Dummy AI.
 * If LLM returns fewer moves than needed, fill the rest with local AI.
 */
export async function computeAiMoveWithLLM(req: AiRequestPayload): Promise<AiResponsePayload> {
  if (req.model && req.model !== "local") {
    const llmMoves = await callLLM(req);
    if (llmMoves && llmMoves.length > 0) {
      const moves = llmMoves.slice(0, req.stonesToPlace);
      // If LLM returned fewer moves than needed, fill with local AI
      if (moves.length < req.stonesToPlace) {
        const remaining = { ...req, stonesToPlace: req.stonesToPlace - moves.length };
        // Apply LLM moves to a working board so local AI doesn't overlap
        const workingBoard = [...req.board];
        for (const m of moves) {
          workingBoard[m.z * req.config.sizeY * req.config.sizeX + m.y * req.config.sizeX + m.x] = req.aiColor;
        }
        const localResult = computeAiMove({ ...remaining, board: workingBoard });
        moves.push(...localResult.moves);
      }
      return { moves };
    }
  }
  return computeAiMove(req);
}
