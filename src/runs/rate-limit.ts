export type RunRateLimiter = {
  acquire(actorId: string): { ok: true } | { ok: false; reason: string };
  release(actorId: string): void;
};

export function createRunRateLimiter(options?: {
  maxConcurrent?: number;
  maxPerWindow?: number;
  windowMs?: number;
}): RunRateLimiter {
  const maxConcurrent = options?.maxConcurrent ?? 8;
  const maxPerWindow = options?.maxPerWindow ?? 30;
  const windowMs = options?.windowMs ?? 60_000;
  const inFlight = new Map<string, number>();
  const stamps = new Map<string, number[]>();

  return {
    acquire(actorId) {
      const now = Date.now();
      const recent = (stamps.get(actorId) ?? []).filter((stamp) => now - stamp < windowMs);
      if (recent.length >= maxPerWindow) {
        return { ok: false, reason: "actor exceeded the run rate limit" };
      }
      const current = inFlight.get(actorId) ?? 0;
      if (current >= maxConcurrent) {
        return { ok: false, reason: "actor exceeded the concurrent run limit" };
      }
      recent.push(now);
      stamps.set(actorId, recent);
      inFlight.set(actorId, current + 1);
      return { ok: true };
    },
    release(actorId) {
      const current = inFlight.get(actorId) ?? 0;
      if (current <= 1) {
        inFlight.delete(actorId);
        return;
      }
      inFlight.set(actorId, current - 1);
    },
  };
}
