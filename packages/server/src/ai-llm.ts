import {
  computeAiMove,
  type AiRequestPayload,
  type AiResponsePayload,
  type AiModelId,
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
  const boardText = buildBoardText(board, sx, sy, sz);

  const system = `You are a Connect6 game AI playing on a 3D board (${sx}x${sy}x${sz}).
Win condition: get ${winLength} in a row on any straight line (orthogonal, face diagonal, or space diagonal).
Coordinates are (x, y, z) where x=0..${sx - 1}, y=0..${sy - 1}, z=0..${sz - 1}.
You play as ${colorName}. Respond with ONLY your move coordinates in format: (x, y, z).
No explanation needed. Just the coordinates.`;

  const user = `Current board state (X=Black, O=White, .=empty):

${boardText}

You are ${colorName}. You need to place ${stonesToPlace} stone(s).
What is your best move? Reply with coordinates only: (x, y, z)`;

  return { system, user };
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
