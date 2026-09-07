import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads KEY=VALUE pairs from a dotenv file into `process.env` without
 * overriding variables that are already set. CLI entry points (seed, migrate)
 * do not get Next.js automatic `.env` loading.
 */
export function applyDotenvFile(filePath = resolve(process.cwd(), ".env")): void {
  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, "utf8");
  for (const raw of contents.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match?.[1] || process.env[match[1]] !== undefined) {
      continue;
    }
    process.env[match[1]] = unquote(match[2] ?? "");
  }
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
