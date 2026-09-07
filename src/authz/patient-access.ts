import type { Encounter, CareTask, Provider } from "@/lib/domain";

export type PatientAccessDeps = {
  providers: { getById(id: string): Promise<Provider | null> };
  encounters: { listByProviderId(providerId: string): Promise<Encounter[]> };
  careTasks: { listByAssignedTo(providerId: string): Promise<CareTask[]> };
};

/**
 * Deterministic patient scope for a human clinician. Derived from durable
 * relationships in the store, never from a request body or a model claim:
 * a provider may act on patients they have an encounter with, or patients
 * with a care task assigned to them.
 */
export async function listAuthorizedPatientIds(
  deps: PatientAccessDeps,
  providerId: string,
): Promise<string[]> {
  const [encounters, careTasks] = await Promise.all([
    deps.encounters.listByProviderId(providerId),
    deps.careTasks.listByAssignedTo(providerId),
  ]);

  const ids = new Set<string>();
  for (const encounter of encounters) {
    ids.add(encounter.patientId);
  }
  for (const task of careTasks) {
    ids.add(task.patientId);
  }

  return [...ids];
}

export type ResolvedClinician = {
  actor: { id: string; role: Provider["role"] };
  name: string;
  authorizedPatientIds: string[];
};

/**
 * Resolves the acting clinician from an opaque identifier. The role is read
 * from the store, so a caller cannot present its own role or scope. Real
 * authentication replaces the identifier lookup, not this boundary.
 */
export async function resolveClinician(
  deps: PatientAccessDeps,
  providerId: string | null | undefined,
): Promise<ResolvedClinician | null> {
  if (!providerId) {
    return null;
  }

  const provider = await deps.providers.getById(providerId);
  if (!provider) {
    return null;
  }

  return {
    actor: { id: provider.id, role: provider.role },
    name: provider.name,
    authorizedPatientIds: await listAuthorizedPatientIds(deps, provider.id),
  };
}
