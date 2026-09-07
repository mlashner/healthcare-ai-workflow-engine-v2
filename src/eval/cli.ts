import "./preload-env";

import { evalCategories, type EvalCategory } from "./types";
import { runEvalSuite } from "./run";

async function main(): Promise<void> {
  const categories = parseCategories(process.argv.slice(2));
  const { report, jsonPath, result } = await runEvalSuite({ categories });
  process.stdout.write(report);
  process.stdout.write(`wrote ${jsonPath}\n`);
  if (result.metrics.scenarioCount === 0) {
    process.exitCode = 1;
  }
}

function parseCategories(argv: string[]): EvalCategory[] | undefined {
  const index = argv.findIndex((arg) => arg === "--category" || arg === "--categories");
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value) {
    throw new Error("expected a comma-separated category list after --category");
  }
  return value.split(",").map((item) => {
    const category = item.trim();
    if (!evalCategories.includes(category as EvalCategory)) {
      throw new Error(`unknown eval category: ${category}`);
    }
    return category as EvalCategory;
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "eval suite failed";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
