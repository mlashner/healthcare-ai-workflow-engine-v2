export const FICTIONAL_KNOWLEDGE_DISCLAIMER =
  "DEMO ONLY — fictional CarePilot demonstration text. This is not medical advice, not a clinical guideline, and not for patient care.";

export function fictionalKnowledgeBody(...paragraphs: string[]): string {
  return [FICTIONAL_KNOWLEDGE_DISCLAIMER, "", ...paragraphs].join("\n\n");
}
