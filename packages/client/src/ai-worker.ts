/**
 * Web Worker for AI computation.
 * Runs computeAiMove off the main thread so UI stays responsive.
 */
import { computeAiMove, type AiRequestPayload } from "@connect6/shared";

self.onmessage = (e: MessageEvent<{ id: number; req: AiRequestPayload }>) => {
  const { id, req } = e.data;

  try {
    // Run the heavy AI computation
    const result = computeAiMove(req);

    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "本地引擎计算失败",
    });
  }
};
