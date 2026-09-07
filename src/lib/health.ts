export type CheckResult = "ok" | "error";

export type HealthStatus = {
  status: "ok" | "degraded";
  service: "carepilot";
  checks: {
    database: CheckResult;
  };
  timestamp: string;
};

export async function buildHealthStatus(ping: () => Promise<void>): Promise<HealthStatus> {
  let database: CheckResult = "ok";
  try {
    await ping();
  } catch {
    database = "error";
  }

  return {
    status: database === "ok" ? "ok" : "degraded",
    service: "carepilot",
    checks: { database },
    timestamp: new Date().toISOString(),
  };
}
