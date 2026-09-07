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

const MEDICATION_CHANGE =
  /\b((change|adjust|increase|decrease|titrate|stop|discontinue|start|prescribe|deprescrib|switch|raise|lower)\b[\s\S]{0,40}\b(dose|dosage|medication|meds|insulin|metformin|lisinopril|albuterol|prescription|rx)\b|\b(dose|dosage|medication|meds|insulin|metformin|lisinopril|albuterol|prescription|rx)\b[\s\S]{0,40}\b(change|adjust|increase|decrease|titrate|stop|discontinue|start|prescribe|switch|raise|lower)\b)/i;

const APPROVAL_BYPASS =
  /\b(skip approval|bypass approval|without (human )?approval|no (human )?approval needed|execute (now|immediately)|just do it)\b/i;

const PRIVILEGE_ESCALATION =
  /\b(you are (now )?(admin|system)|ignore (previous|safety)|grant (yourself|me) |change (your |my )?role|unauthorized (access|patient))\b/i;

const CHART_DUMP =
  /\b(all patients|every patient|entire (chart|record|database)|dump (the )?(db|database|phi)|full (chart|ehr)|unredacted|social security|\bssn\b)\b/i;

const SECRET_LEAK = /\b(api[_-]?key|password|bearer\s+[a-z0-9._-]+|postgres:\/\/|DATABASE_URL)\b/i;

const PATIENT_ID = /patient_[A-Za-z0-9_-]+/g;

export function containsMedicationChange(text: string): boolean {
  return MEDICATION_CHANGE.test(text);
}

export function containsApprovalBypass(text: string): boolean {
  return APPROVAL_BYPASS.test(text);
}

export function containsPrivilegeEscalation(text: string): boolean {
  return PRIVILEGE_ESCALATION.test(text);
}

export function collectMentionedPatientIds(text: string): string[] {
  return [...text.matchAll(PATIENT_ID)].map((match) => match[0]);
}

export function detectUnauthorizedDisclosure(
  text: string,
  patientScope: string,
): string | undefined {
  if (CHART_DUMP.test(text)) {
    return "recommendation asks for an unauthorized chart or population dump";
  }
  if (SECRET_LEAK.test(text)) {
    return "recommendation exposes credentials or operational secrets";
  }
  const outsiders = collectMentionedPatientIds(text).filter((id) => id !== patientScope);
  if (outsiders.length > 0) {
    return `recommendation exposes out-of-scope patient identifiers: ${outsiders.join(", ")}`;
  }
  return undefined;
}
