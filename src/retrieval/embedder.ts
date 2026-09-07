import { EMBEDDING_DIMENSIONS } from "@/lib/db/schema";

export type Embedder = {
  dimensions: number;
  embed(text: string): number[];
};

const TOPIC_LEXICONS: string[][] = [
  ["diabetes", "glucose", "metformin", "insulin", "a1c", "hyperglycemia", "hypoglycemia", "endocrinology", "glycemic"],
  ["hypertension", "pressure", "lisinopril", "systolic", "diastolic", "bp"],
  ["fall", "falls", "dizziness", "gait", "balance", "unsteady"],
  ["nutrition", "diet", "sodium", "carbohydrate", "carbs", "meal", "food"],
  ["adherence", "refill", "missed", "dose", "compliance"],
  ["communication", "teachback", "literacy", "plain", "language", "message"],
  ["escalation", "urgent", "chest", "redflag", "emergency", "severe"],
  ["side", "effects", "nausea", "cough", "hypoglycemia", "tachycardia", "dehydration"],
  ["asthma", "inhaler", "albuterol", "wheeze", "rescue"],
  ["heart", "failure", "weight", "edema", "furosemide", "carvedilol"],
];

export function createLexicalEmbedder(dimensions = EMBEDDING_DIMENSIONS): Embedder {
  return {
    dimensions,
    embed(text: string) {
      const vector = new Array<number>(dimensions).fill(0);
      const tokens = tokenize(text);

      for (const token of tokens) {
        const topicIndex = TOPIC_LEXICONS.findIndex((lexicon) => lexicon.includes(token));
        if (topicIndex >= 0 && topicIndex < dimensions) {
          vector[topicIndex] = (vector[topicIndex] ?? 0) + 2;
        }

        const hashed = (fnv1a(token) % Math.max(1, dimensions - TOPIC_LEXICONS.length)) + TOPIC_LEXICONS.length;
        if (hashed < dimensions) {
          vector[hashed] = (vector[hashed] ?? 0) + 1;
        }
      }

      return l2Normalize(vector);
    },
  };
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return dot;
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "only",
  "not",
  "may",
  "can",
  "after",
  "demo",
  "fictional",
  "demonstration",
  "carepilot",
  "medical",
  "advice",
  "guideline",
  "text",
  "card",
  "corpus",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function l2Normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return vector;
  }
  return vector.map((value) => value / magnitude);
}
