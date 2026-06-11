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
 * Falls back to local AI on any failure.
 */

let LLM_API_KEY = "ak-a441b4719add46ae930f0246782c22d0";
const LLM_TIMEOUT_MS = 120_000; // 2 minutes

export function setAiApiKey(key: string) {
  LLM_API_KEY = key;
}

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

// ─── Board visualization ───

function stoneChar(stone: Stone): string {
  if (stone === Stone.BLACK) return "X";
  if (stone === Stone.WHITE) return "O";
  return ".";
}

/**
 * Build a compact board visualization.
 * Only shows layers that have stones, with coordinate axes.
 */
function buildBoardText(board: number[], sx: number, sy: number, sz: number): string {
  const layers: string[] = [];

  for (let z = 0; z < sz; z++) {
    // Skip empty layers
    let hasContent = false;
    for (let i = z * sy * sx; i < (z + 1) * sy * sx; i++) {
      if (board[i] !== Stone.EMPTY) { hasContent = true; break; }
    }
    if (!hasContent && z !== 0 && z !== sz - 1) continue;

    const lines: string[] = [`── Z=${z} ${"─".repeat(sx * 3 - 1)}`];
    // X axis header
    lines.push("   " + Array.from({ length: sx }, (_, i) => String(i).padStart(2)).join(" "));
    for (let y = 0; y < sy; y++) {
      const row = Array.from({ length: sx }, (_, x) =>
        stoneChar(board[z * sy * sx + y * sx + x] as Stone).padStart(2),
      ).join(" ");
      lines.push(`${y.toString().padStart(2)} ${row}`);
    }
    layers.push(lines.join("\n"));
  }

  return layers.join("\n");
}

// ─── Move parsing & validation ───

function parseMovesFromText(text: string, count: number): { x: number; y: number; z: number }[] {
  const moves: { x: number; y: number; z: number }[] = [];
  // Match (x,y,z) format, also handle x,y,z without parens
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

// ─── Position analysis for LLM context ───

interface ThreatData {
  myWins: string[];
  oppWins: string[];
  myOpen5: string[];
  oppOpen5: string[];
  myOpen4Count: number;
  oppOpen4Count: number;
  myOpen3Count: number;
  oppOpen3Count: number;
}

function analyzeThreats(board: number[], config: BoardConfig, aiStone: Stone): ThreatData {
  const { sizeX: sx, sizeY: sy, sizeZ: sz } = config;
  const oppStone = aiStone === Stone.BLACK ? Stone.WHITE : Stone.BLACK;

  const result: ThreatData = {
    myWins: [], oppWins: [],
    myOpen5: [], oppOpen5: [],
    myOpen4Count: 0, oppOpen4Count: 0,
    myOpen3Count: 0, oppOpen3Count: 0,
  };

  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        if (board[z * sy * sx + y * sx + x] !== Stone.EMPTY) continue;

        const myScore = scoreCell(board, config, x, y, z, aiStone);
        const oppScore = scoreCell(board, config, x, y, z, oppStone);

        if (myScore >= 500000) result.myWins.push(`(${x},${y},${z})`);
        if (oppScore >= 500000) result.oppWins.push(`(${x},${y},${z})`);
        if (myScore >= 50000 && myScore < 500000) result.myOpen5.push(`(${x},${y},${z})`);
        if (oppScore >= 50000 && oppScore < 500000) result.oppOpen5.push(`(${x},${y},${z})`);
        if (myScore >= 1200 && myScore < 50000) result.myOpen4Count++;
        if (oppScore >= 1200 && oppScore < 50000) result.oppOpen4Count++;
        if (myScore >= 100 && myScore < 1200) result.myOpen3Count++;
        if (oppScore >= 100 && oppScore < 1200) result.oppOpen3Count++;
      }
    }
  }

  return result;
}

function formatThreatAnalysis(threats: ThreatData, winLength: number): string {
  const lines: string[] = [];

  if (threats.oppWins.length > 0)
    lines.push(`🚨 OPPONENT CAN WIN at: ${threats.oppWins.join(", ")} — YOU MUST BLOCK!`);
  if (threats.myWins.length > 0)
    lines.push(`✅ YOU CAN WIN at: ${threats.myWins.join(", ")} — PLAY THIS!`);
  if (threats.oppOpen5.length > 0)
    lines.push(`⚠️ Opponent Open-${winLength - 1} at: ${threats.oppOpen5.slice(0, 5).join(", ")} — block one end.`);
  if (threats.myOpen5.length > 0)
    lines.push(`🎯 Your Open-${winLength - 1} at: ${threats.myOpen5.slice(0, 5).join(", ")} — press advantage.`);
  if (threats.myOpen4Count >= 2)
    lines.push(`💪 You have ${threats.myOpen4Count} Open-${winLength - 2} — double-threat opportunity!`);
  if (threats.oppOpen4Count >= 2)
    lines.push(`🛡️ Opponent has ${threats.oppOpen4Count} Open-${winLength - 2} — watch for double threats.`);
  if (threats.myOpen3Count > 0)
    lines.push(`📈 You have ${threats.myOpen3Count} Open-${winLength - 3} lines building.`);
  if (threats.oppOpen3Count > 0)
    lines.push(`📉 Opponent has ${threats.oppOpen3Count} Open-${winLength - 3} lines building.`);

  if (lines.length === 0)
    lines.push("📋 No immediate threats. Build open lines toward center.");

  return lines.join("\n");
}

// ─── Prompt construction ───

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

  const threats = analyzeThreats(board, config, aiColor as unknown as Stone);
  const threatText = formatThreatAnalysis(threats, winLength);
  const round = blackCount + whiteCount;
  const cx = Math.floor(sx / 2), cy = Math.floor(sy / 2), cz = Math.floor(sz / 2);

  const system = `You are an elite Connect6 AI. You play on a ${sx}×${sy}×${sz} 3D board.
You are ${colorName}. Opponent is ${oppName}.

═══ RULES ═══
• Coordinates: (x, y, z) where x∈[0,${sx - 1}], y∈[0,${sy - 1}], z∈[0,${sz - 1}]
• Round 0: Black places 1 stone. All later rounds: each player places 2 stones.
• WIN: ${winLength} stones in a straight line. There are 13 possible directions:
  - 3 axis-aligned: (1,0,0), (0,1,0), (0,0,1)
  - 6 face diagonals: (1,1,0), (1,-1,0), (1,0,1), (1,0,-1), (0,1,1), (0,1,-1)
  - 4 space diagonals: (1,1,1), (1,1,-1), (1,-1,1), (1,-1,-1)
• Only place on empty cells (".").
• Lines are bidirectional — check both +d and -d from each stone.

═══ STRATEGY (by priority) ═══

1. WIN: If you can complete ${winLength} in a row, do it immediately.
2. BLOCK IMMEDIATE THREATS (HIGHEST PRIORITY AFTER WINNING):
   - Opponent has ${winLength - 1} in a row with open ends → BLOCK NOW
   - Opponent has ${winLength - 2} in a row with both ends open → BLOCK NOW (forcing)
   - Opponent has ${winLength - 1} with one end blocked → still block the open end
   - Even ${winLength - 3} with both ends open is dangerous — consider blocking
3. DOUBLE THREAT: Create TWO separate open-${winLength - 1} lines simultaneously.
   Opponent blocks one → you complete the other → WIN. This is the KEY to Connect6.
4. BUILD: Create open lines (both ends empty). Open-4 > half-open-4 > open-3.
5. CENTER: Cells near (${cx},${cy},${cz}) participate in more directions.
6. BOTH STONES: With 2 stones/turn, coordinate them:
   a) Two separate threats (best)
   b) One block + one attack
   c) Extend one line from open-3 to open-5

⚠️ NEVER ignore an opponent threat to build your own line. Defense comes first!

═══ 3D AWARENESS ═══
• Do NOT forget space diagonals — they're the hardest to block.
• A stone at (x,y,z) can simultaneously be part of lines in all 13 directions.
• Z-axis lines (vertical) are often overlooked by opponents.

═══ CRITICAL RULES ═══
• You MUST place exactly ${stonesToPlace} stone(s) this turn.
• You CANNOT place on an occupied cell.
• Output ONLY coordinates on the last line: (x,y,z) or (x1,y1,z1) (x2,y2,z2)
• No explanation needed. Think step by step internally, then output only the move.`;

  const user = `Board (X=Black, O=White, .=empty). Axes: X→right, Y→away, Z→up.

${boardText}

Round ${round} | You are ${colorName} | Place ${stonesToPlace} stone(s)
Black: ${blackCount} | White: ${whiteCount}

THREAT ANALYSIS:
${threatText}

Analyze all 13 directions for each candidate. Choose the BEST move(s).
Output ONLY coordinates: (x,y,z) or (x1,y1,z1) (x2,y2,z2)`;

  return { system, user };
}

// ─── API calls ───

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
      temperature: 0.1,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? null;
}

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
      temperature: 0.1,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { content?: { type: string; text: string }[] };
  return data.content?.find(b => b.type === "text")?.text ?? null;
}

// ─── LLM call with validation ───

async function callLLM(req: AiRequestPayload): Promise<{ x: number; y: number; z: number }[] | null> {
  const modelId = req.model ?? "local";
  if (modelId === "local") return null;

  const cfg = MODEL_ENDPOINTS[modelId];
  if (!cfg) return null;

  const { system, user } = buildPrompts(req);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    const text = cfg.protocol === "openai"
      ? await callOpenAI(cfg, system, user, controller.signal)
      : await callAnthropic(cfg, system, user, controller.signal);

    clearTimeout(timer);
    if (!text) return null;

    const parsed = parseMovesFromText(text, req.stonesToPlace);
    const validated = validateMoves(parsed, req.board, req.config.sizeX, req.config.sizeY, req.config.sizeZ);

    // If LLM returned invalid moves, log for debugging
    if (parsed.length > 0 && validated.length === 0) {
      console.log(`[AI] LLM returned invalid moves: ${JSON.stringify(parsed)}`);
    }

    return validated;
  } catch {
    return null;
  }
}

// ─── Public API ───

export async function computeAiMoveWithLLM(req: AiRequestPayload): Promise<AiResponsePayload> {
  if (req.model && req.model !== "local") {
    const llmMoves = await callLLM(req);
    if (llmMoves && llmMoves.length > 0) {
      const moves = llmMoves.slice(0, req.stonesToPlace);
      // Fill missing moves with local AI
      if (moves.length < req.stonesToPlace) {
        const workingBoard = [...req.board];
        for (const m of moves) {
          workingBoard[m.z * req.config.sizeY * req.config.sizeX + m.y * req.config.sizeX + m.x] = req.aiColor;
        }
        const remaining = { ...req, stonesToPlace: req.stonesToPlace - moves.length, board: workingBoard };
        const localResult = computeAiMove(remaining);
        moves.push(...localResult.moves);
      }
      return { moves };
    }
  }
  return computeAiMove(req);
}

/**
 * Call LLM for strategic analysis text (not moves).
 * Used by the training mode analysis panel.
 */
export async function callLLMForAnalysis(req: AiRequestPayload): Promise<string | null> {
  const modelId = req.model ?? "qwen3.6-plus";
  const cfg = MODEL_ENDPOINTS[modelId as keyof typeof MODEL_ENDPOINTS];
  if (!cfg) return null;

  const { board, config, aiColor, stonesToPlace } = req;
  const { sizeX: sx, sizeY: sy, sizeZ: sz } = config;
  const colorName = aiColor === Player.BLACK ? "Black (X)" : "White (O)";
  const aiStone = aiColor as unknown as Stone;

  // Build compact board text
  const lines: string[] = [];
  for (let z = 0; z < sz; z++) {
    let hasContent = false;
    for (let i = z * sy * sx; i < (z + 1) * sy * sx; i++) {
      if (board[i] !== 0) { hasContent = true; break; }
    }
    if (!hasContent && z !== 0 && z !== sz - 1) continue;
    const layer: string[] = [`Z=${z}:`];
    for (let y = 0; y < sy; y++) {
      const row = Array.from({ length: sx }, (_, x) => {
        const s = board[z * sy * sx + y * sx + x];
        return s === 1 ? "X" : s === 2 ? "O" : ".";
      }).join(" ");
      layer.push(`  Y=${y}: ${row}`);
    }
    lines.push(layer.join("\n"));
  }

  // Pre-compute threat data for the prompt
  const oppStone = aiStone === Stone.BLACK ? Stone.WHITE : Stone.BLACK;
  let myWins = 0, oppWins = 0, myOpen5 = 0, oppOpen5 = 0;
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        if (board[z * sy * sx + y * sx + x] !== Stone.EMPTY) continue;
        const ms = scoreCell(board, config, x, y, z, aiStone);
        const os = scoreCell(board, config, x, y, z, oppStone);
        if (ms >= 500000) myWins++;
        if (os >= 500000) oppWins++;
        if (ms >= 50000 && ms < 500000) myOpen5++;
        if (os >= 50000 && os < 500000) oppOpen5++;
      }
    }
  }

  const threatSummary = [
    oppWins > 0 ? `对手有${oppWins}个直接获胜点` : "",
    myWins > 0 ? `你有${myWins}个直接获胜点` : "",
    oppOpen5 > 0 ? `对手有${oppOpen5}个差一子的威胁` : "",
    myOpen5 > 0 ? `你有${myOpen5}个差一子的机会` : "",
  ].filter(Boolean).join("；") || "无紧急威胁";

  const system = `你是一个专业的Connect6游戏分析师。用中文回答，简洁直接。
棋盘: ${sx}×${sy}×${sz} 三维。胜利条件: ${config.winLength}子连成一线(13个方向)。
你的回答必须具体指出坐标位置，不要泛泛而谈。`;

  const user = `当前局面分析:
- 当前玩家: ${colorName}，需要放 ${stonesToPlace} 颗棋子
- 威胁评估: ${threatSummary}

${lines.join("\n")}

请分析:
1. 最佳落子位置是哪里？(给出具体坐标)
2. 为什么这个位置最好？(能形成什么线？能堵住什么威胁？)
3. 有没有必须立即应对的威胁？

直接给出结论，不要太长。`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    const text = cfg.protocol === "openai"
      ? await callOpenAI(cfg, system, user, controller.signal)
      : await callAnthropic(cfg, system, user, controller.signal);

    clearTimeout(timer);
    return text;
  } catch {
    return null;
  }
}
