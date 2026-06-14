/**
 * Web Worker for AI computation.
 * Runs computeAiMove off the main thread so UI stays responsive.
 */
import { computeAiMove, computeAiMoveWithMemory, type AiRequestPayload } from "@connect6/shared";

self.onmessage = (e: MessageEvent<{ id: number; req: AiRequestPayload }>) => {
  const { id, req } = e.data;

  try {
    // Run the heavy AI computation
    const result = computeAiMove(req);

    self.postMessage({ id, result });
  } catch {
    self.postMessage({ id, result: { moves: [] } });
  }
};
