import { createRepositoryAuditWriter } from "@/audit/writer";
import { resolveClinician, type ResolvedClinician } from "@/authz/patient-access";
import { getDb } from "@/lib/db";
import { createRepositories, type Repositories } from "@/lib/db/repositories";
import { createReviewDecisionService } from "@/review/decisions";
import { createToolGateway } from "@/tools/gateway";
import { createToolRegistry } from "@/tools/catalog";

/**
 * Header used to stand in for authenticated sign-in in this demo. It carries
 * only an opaque provider id; the role and patient scope are read from the
 * store, so presenting a header cannot grant privileges.
 */
export const CLINICIAN_HEADER = "x-carepilot-clinician";
export const CLINICIAN_COOKIE = "carepilot_clinician";

export function getReviewContext() {
  const repos = createRepositories(getDb());
  const audit = createRepositoryAuditWriter(repos.auditEvents);
  const registry = createToolRegistry(repos);
  const gateway = createToolGateway({ registry, audit });

  return {
    repos,
    audit,
    registry,
    gateway,
    decisions: createReviewDecisionService({ repos, registry, gateway, audit }),
  };
}

export async function resolveRequestClinician(
  repos: Repositories,
  providerId: string | null | undefined,
): Promise<ResolvedClinician | null> {
  return resolveClinician(
    {
      providers: repos.providers,
      encounters: repos.encounters,
      careTasks: repos.careTasks,
    },
    providerId,
  );
}
