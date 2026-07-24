import { useRef, useCallback, useEffect } from "react";
import type { AiRequestPayload, AiResponsePayload } from "@connect6/shared";

const AI_TIMEOUT_MS = 8_000;

interface PendingRequest {
  resolve: (result: AiResponsePayload) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface WorkerReply {
  id: number;
  result?: AiResponsePayload;
  error?: string;
}

/**
 * Hook that offloads AI computation to a Web Worker.
 * Returns a function that sends a request and resolves with the result.
 * The main thread stays completely free during computation.
 */
export function useAiWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<number, PendingRequest>>(new Map());
  const idRef = useRef(0);

  const rejectAll = useCallback((message: string) => {
    const error = new Error(message);
    for (const pending of pendingRef.current.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    pendingRef.current.clear();
  }, []);

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = new Worker(
        new URL("../ai-worker.ts", import.meta.url),
        { type: "module" }
      );
      worker.onmessage = (e: MessageEvent<WorkerReply>) => {
        const { id, result, error } = e.data;
        const pending = pendingRef.current.get(id);
        if (pending) {
          pendingRef.current.delete(id);
          clearTimeout(pending.timeout);
          if (error || !result) pending.reject(new Error(error || "本地引擎未返回结果"));
          else pending.resolve(result);
        }
      };
      worker.onerror = () => {
        rejectAll("本地引擎运行异常");
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      };
      workerRef.current = worker;
    }
    return workerRef.current;
  }, [rejectAll]);

  const compute = useCallback((req: AiRequestPayload): Promise<AiResponsePayload> => {
    return new Promise((resolve, reject) => {
      const id = ++idRef.current;
      const timeout = setTimeout(() => {
        const pending = pendingRef.current.get(id);
        if (!pending) return;
        pendingRef.current.delete(id);
        pending.reject(new Error("本地引擎计算超时"));
        workerRef.current?.terminate();
        workerRef.current = null;
      }, AI_TIMEOUT_MS);
      pendingRef.current.set(id, { resolve, reject, timeout });
      try {
        getWorker().postMessage({ id, req });
      } catch (error) {
        pendingRef.current.delete(id);
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error("无法启动本地引擎"));
      }
    });
  }, [getWorker]);

  useEffect(() => () => {
    rejectAll("本地引擎已停止");
    workerRef.current?.terminate();
    workerRef.current = null;
  }, [rejectAll]);

  return { compute };
}
