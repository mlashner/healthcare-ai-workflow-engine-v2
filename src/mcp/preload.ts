process.env.DATABASE_URL ??= "postgres://carepilot:carepilot@localhost:5432/carepilot";
process.env.LOG_LEVEL ??= "error";

// Stdio MCP reserves stdout for JSON-RPC. Never print protocol noise there.
console.log = (...args: unknown[]) => {
  process.stderr.write(`${args.map(String).join(" ")}\n`);
};
console.info = (...args: unknown[]) => {
  process.stderr.write(`${args.map(String).join(" ")}\n`);
};
