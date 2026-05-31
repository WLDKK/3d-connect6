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
const LLM_TIMEOUT_MS = 180000; // 3 minutes

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

  // Count stones for context
  let blackCount = 0, whiteCount = 0;
  for (const s of board) {
    if (s === Stone.BLACK) blackCount++;
    if (s === Stone.WHITE) whiteCount++;
  }

  // Find threatening patterns for strategic context
  const threats = findThreats(board, config, aiColor as unknown as Stone);

  const system = `You are an expert Connect6 AI player on a 3D board of ${sx}×${sy}×${sz}.
You play as ${colorName} against ${oppName}.

RULES:
- The board is 3D: coordinates are (x, y, z), each ranging 0 to ${sx - 1}.
- First move (round 0): Black places 1 stone.
- After round 0: each player places 2 stones per turn.
- WIN: first to get ${winLength} stones in a straight line wins.
- Lines can be: axis-aligned (X/Y/Z), face diagonal (2D diagonal on any face), or space diagonal (3D diagonal).
- You must place on EMPTY cells only.

STRATEGY (prioritized):
1. WIN: If you can complete ${winLength} in a row, do it immediately.
2. BLOCK: If opponent has ${winLength - 1} in a row with both ends open, you MUST block one end.
3. DOUBLE THREAT: Create two lines of ${winLength - 1}+ simultaneously — opponent can't block both.
4. EXTEND: Build your own lines toward ${winLength}. Center positions are more valuable.
5. NEVER place next to your own stones if it doesn't extend a meaningful line.

You are a GRANDMASTER. Think carefully about which move creates the most threats.
Reply with ONLY the coordinate(s). Format: (x, y, z) or (x1,y1,z1) (x2,y2,z2) for 2 stones.
No explanation. Just coordinates.`;

  const user = `Board (${sx}×${sy}×${sz}), you are ${colorName}. Place ${stonesToPlace} stone(s).
${blackCount} black, ${whiteCount} white on board.

${boardText}
${threats ? `\n⚠️ Threats: ${threats}` : ""}

Your best move (coordinates only):`;

  return { system, user };
}

/**
 * Find threatening patterns for strategic context.
 * Returns a human-readable string of immediate threats.
 */
function findThreats(board: number[], config: BoardConfig, aiStone: Stone): string {
  const { sizeX: sx, sizeY: sy, sizeZ: sz, winLength } = config;
  const oppStone = aiStone === Stone.BLACK ? Stone.WHITE : Stone.BLACK;
  const threats: string[] = [];

  // Check all cells for high-value patterns
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        const stone = board[z * sy * sx + y * sx + x] as Stone;
        if (stone !== Stone.EMPTY) continue;

        // Check if opponent placing here would create a threat
        const oppScore = scoreCell(board, config, x, y, z, oppStone);
        const aiScore = scoreCell(board, config, x, y, z, aiStone);

        if (oppScore >= winLength - 1) {
          threats.push(`Opponent can reach ${oppScore} at (${x},${y},${z}) — BLOCK THIS!`);
        }
        if (aiScore >= winLength - 1) {
          threats.push(`You can reach ${aiScore} at (${x},${y},${z}) — TAKE THIS!`);
        }
      }
    }
  }

  // Deduplicate and limit
  const unique = [...new Set(threats)].slice(0, 5);
  return unique.length > 0 ? unique.join("; ") : "";
}

/** Call using OpenAI-compatible protocol */
async function callOpenAI(cfg: ModelConfig, system: string, user: string): Promise<string | null> {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 100,
      temperature: 0.3,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? null;
}

/** Call using Anthropic protocol */
async function callAnthropic(cfg: ModelConfig, system: string, user: string): Promise<string | null> {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": LLM_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 100,
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
      ? await callOpenAI(cfg, system, user)
      : await callAnthropic(cfg, system, user);

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
 */
export async function computeAiMoveWithLLM(req: AiRequestPayload): Promise<AiResponsePayload> {
  if (req.model && req.model !== "local") {
    const llmMoves = await callLLM(req);
    if (llmMoves && llmMoves.length > 0) {
      return { moves: llmMoves.slice(0, req.stonesToPlace) };
    }
  }
  return computeAiMove(req);
}
