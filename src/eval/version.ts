import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function readAgentVersion(): string {
  const packageJson = JSON.parse(readFileSync(packageJsonPath(), "utf8")) as { version?: string };
  return packageJson.version ?? "0.0.0";
}

export function readGitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      cwd: repoRoot(),
    }).trim();
  } catch {
    return "unknown";
  }
}

export function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../..");
}

function packageJsonPath(): string {
  return join(repoRoot(), "package.json");
}
