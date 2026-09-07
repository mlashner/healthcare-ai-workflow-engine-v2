const patientIdKeys = ["patientId", "patient_id", "targetPatientId"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Edits are merged, then every patient identifier is rebound to the run's
 * patient. Top-level ids are kept only when the original args had them, so
 * tools whose schema has no top-level `patientId` stay valid. Nested payload
 * ids are always overwritten when a payload object is present.
 */
export function imposePatientScope(
  original: Record<string, unknown>,
  merged: Record<string, unknown>,
  patientId: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...merged };

  for (const key of patientIdKeys) {
    if (Object.prototype.hasOwnProperty.call(original, key)) {
      next[key] = patientId;
    } else {
      delete next[key];
    }
  }

  if (isPlainObject(next.payload)) {
    const payload: Record<string, unknown> = { ...next.payload };
    payload.patientId = patientId;
    if (Object.prototype.hasOwnProperty.call(payload, "patient_id")) {
      payload.patient_id = patientId;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "targetPatientId")) {
      payload.targetPatientId = patientId;
    }
    next.payload = payload;
  }

  return next;
}
