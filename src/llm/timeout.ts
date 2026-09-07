import { ModelError } from "./errors";
import type { ModelProvider } from "./types";

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ModelError("TIMEOUT", message));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createTimedModelProvider(
  provider: ModelProvider,
  timeoutMs: number,
): ModelProvider {
  return {
    complete(request) {
      return withTimeout(
        provider.complete(request),
        timeoutMs,
        `model provider timed out after ${timeoutMs}ms`,
      );
    },
  };
}
