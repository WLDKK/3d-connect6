export { GameRoom } from "./room";

import { computeAiMoveWithLLM, callLLMForAnalysis, setAiApiKey } from "./ai-llm";
import type { AiRequestPayload } from "@connect6/shared";

interface Env {
  ROOM: DurableObjectNamespace;
  AI_API_KEY?: string; // wrangler secret
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Inject API key from secret on first request
    if (env.AI_API_KEY) setAiApiKey(env.AI_API_KEY);

    const url = new URL(request.url);

    // CORS headers for cross-origin requests from Pages
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Route: POST /api/ai/move — AI inference
    if (request.method === "POST" && url.pathname === "/api/ai/move") {
      const res = await handleAiRequest(request);
      const newHeaders = new Headers(res.headers);
      for (const [k, v] of Object.entries(corsHeaders)) newHeaders.set(k, v);
      return new Response(res.body, { status: res.status, headers: newHeaders });
    }

    // Route: POST /api/ai/analyze — LLM strategic analysis (text)
    if (request.method === "POST" && url.pathname === "/api/ai/analyze") {
      const res = await handleAnalyzeRequest(request);
      const newHeaders = new Headers(res.headers);
      for (const [k, v] of Object.entries(corsHeaders)) newHeaders.set(k, v);
      return new Response(res.body, { status: res.status, headers: newHeaders });
    }

    // Route: /api/room/:id — WebSocket to GameRoom DO
    const match = url.pathname.match(/^\/api\/room\/([^/]+)$/);
    if (match) {
      const roomId = match[1];
      const doId = env.ROOM.idFromName(roomId);
      const stub = env.ROOM.get(doId);
      return stub.fetch(request);
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};

async function handleAiRequest(request: Request): Promise<Response> {
  let payload: AiRequestPayload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload.board || !payload.config || !payload.aiColor) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const start = Date.now();
  const result = await computeAiMoveWithLLM(payload);
  const elapsed = Date.now() - start;

  return Response.json({
    ...result,
    _debug: {
      model: payload.model ?? "local",
      elapsed: `${elapsed}ms`,
      moveCount: result.moves.length,
    },
  });
}

async function handleAnalyzeRequest(request: Request): Promise<Response> {
  let payload: AiRequestPayload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload.board || !payload.config) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const text = await callLLMForAnalysis(payload);
  return Response.json({ text: text || "分析失败，请重试" });
}
