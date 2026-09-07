import { pingDatabase } from "@/lib/db";
import { buildHealthStatus } from "@/lib/health";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const body = await buildHealthStatus(pingDatabase);
  const status = body.status === "ok" ? 200 : 503;

  logger.info("health.check", {
    status: body.status,
    database: body.checks.database,
    httpStatus: status,
  });

  return Response.json(body, { status });
}
