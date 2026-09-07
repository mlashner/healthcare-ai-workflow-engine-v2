const SECRET_KEY = /password|secret|token|authorization|cookie|database_url|api[_-]?key/i;
const CHART_KEY =
  /^(name|dateOfBirth|date_of_birth|transcript|medications|conditions|relevantText|talkingPoints|body)$/i;

function isRedactedKey(key: string): boolean {
  return SECRET_KEY.test(key) || CHART_KEY.test(key);
}

/**
 * Trace payloads reach a clinician, not the model. Secrets and chart
 * demographics are stripped. Model reasoning text (thought, summary) stays so
 * the timeline can show what the agent did.
 */
export function redactForTrace(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactForTrace);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        isRedactedKey(key) ? "[redacted]" : redactForTrace(nested),
      ]),
    );
  }
  return value;
}
