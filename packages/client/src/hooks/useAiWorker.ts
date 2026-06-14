import { useRef, useCallback } from "react";
import type { AiRequestPayload, AiResponsePayload } from "@connect6/shared";

/**
 * Hook that offloads AI computation to a Web Worker.
 * Returns a function that sends a request and resolves with the result.
 * The main thread stays completely free during computation.
 */
export function useAiWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<number, (result: AiResponsePayload) => void>>(new Map());
  const idRef = useRef(0);

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("../ai-worker.ts", import.meta.url),
        { type: "module" }
      );
      workerRef.current.onmessage = (e: MessageEvent<{ id: number; result: AiResponsePayload }>) => {
        const { id, result } = e.data;
        const resolve = pendingRef.current.get(id);
        if (resolve) {
          pendingRef.current.delete(id);
          resolve(result);
        }
      };
    }
    return workerRef.current;
  }, []);

  const compute = useCallback((req: AiRequestPayload): Promise<AiResponsePayload> => {
    return new Promise((resolve) => {
      const id = ++idRef.current;
      pendingRef.current.set(id, resolve);
      getWorker().postMessage({ id, req });
    });
  }, [getWorker]);

  return { compute };
}
