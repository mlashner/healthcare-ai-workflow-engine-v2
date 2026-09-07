import { getEnv } from "@/lib/env";

type LogLevel = "debug" | "info" | "warn" | "error";

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SECRET_KEY =
  /password|secret|(?<![a-z])token(?![a-z])|authorization|cookie|database_url|api[_-]?key/i;
const DEMOGRAPHIC_KEY =
  /^(name|dateOfBirth|date_of_birth|transcript|medications|conditions|talkingPoints|relevantText|thought|body)$/i;

function isSensitiveKey(key: string): boolean {
  return SECRET_KEY.test(key) || DEMOGRAPHIC_KEY.test(key);
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        isSensitiveKey(key) ? "[redacted]" : redact(nested),
      ]),
    );
  }
  return value;
}

function shouldLog(level: LogLevel): boolean {
  try {
    return levelRank[level] >= levelRank[getEnv().LOG_LEVEL];
  } catch {
    return levelRank[level] >= levelRank.info;
  }
}

export function log(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  if (!shouldLog(level)) {
    return;
  }

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(redact(fields) as Record<string, unknown>),
  });

  if (level === "debug") {
    console.log(line);
    return;
  }
  console[level](line);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => log("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => log("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => log("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => log("error", message, fields),
};
