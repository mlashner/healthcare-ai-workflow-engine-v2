import { z } from "zod";

import { applyDotenvFile } from "./load-dotenv";

const logLevels = ["debug", "info", "warn", "error"] as const;

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL must be a postgres:// or postgresql:// connection string",
    ),
  LOG_LEVEL: z.enum(logLevels).default("info"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    applyDotenvFile();
    cached = loadEnv();
  }
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}
