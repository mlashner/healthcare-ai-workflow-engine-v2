const DIAGNOSIS_CLAIM =
  /\b((i|we)\s+(diagnose|diagnosed|are diagnosing)|(?:this|that)\s+is\s+(?:a|the)\s+diagnosis|new diagnosis of|new-onset|presentation is consistent with|assessment\s*:|(?:patient|they)\s+(?:is|are|was|were)\s+diagnosed|confirms?\s+(?:a|the)\s+diagnosis|likely has|this confirms)\b/i;

const CLINICAL_LANGUAGE =
  /\b(insulin|a1c|hba1c|metformin|lisinopril|albuterol|diabetes|hypertension|asthma|heart failure|ckd|referral|escalat|lab[s]?|medication|inhaler|blood pressure|glucose)\b/i;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "after",
  "be",
  "demo",
  "fictional",
  "for",
  "from",
  "human",
  "in",
  "is",
  "may",
  "needed",
  "not",
  "of",
  "on",
  "only",
  "or",
  "review",
  "the",
  "this",
  "that",
  "to",
  "with",
]);

export function containsDiagnosisClaim(text: string): boolean {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.some((sentence) => {
    const negated =
      /\b(not|never|do not|don't|cannot|can't|no)\b/i.test(sentence) &&
      /\bdiagnos/i.test(sentence);
    if (negated) {
      return false;
    }
    return DIAGNOSIS_CLAIM.test(sentence);
  });
}

export function containsClinicalLanguage(text: string): boolean {
  return CLINICAL_LANGUAGE.test(text);
}

export function significantTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
  return new Set(tokens);
}

export function tokenOverlapCount(left: string, right: string): number {
  const other = significantTokens(right);
  let shared = 0;
  for (const token of significantTokens(left)) {
    if (other.has(token)) {
      shared += 1;
    }
  }
  return shared;
}

export function snippetSupportsClaim(claim: string, snippet: string, minimum = 2): boolean {
  return tokenOverlapCount(claim, snippet) >= minimum;
}
