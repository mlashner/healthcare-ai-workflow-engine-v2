import { fictionalKnowledgeCorpus } from "@/retrieval/corpus";
import { createLexicalEmbedder } from "@/retrieval/embedder";
import { ingestKnowledgeCorpus } from "@/retrieval/ingest";

import { closeDb, getDb } from "./client";
import { createRepositories } from "./repositories";
import { seedReviewFixture } from "./seed-review";

/**
 * Stable identifiers for the fictional demonstration corpus.
 * These records are not real people and are not for clinical use.
 */
export const seedIds = {
  patients: {
    ava: "patient_fictional_ava",
    marcus: "patient_fictional_marcus",
    priya: "patient_fictional_priya",
  },
  providers: {
    vargas: "provider_fictional_vargas",
    blake: "provider_fictional_blake",
    okonkwo: "provider_fictional_okonkwo",
    patel: "provider_fictional_patel",
  },
  encounters: {
    avaFollowUp: "encounter_fictional_ava_followup",
    marcusAsthma: "encounter_fictional_marcus_asthma",
  },
  documents: {
    diabetesFollowUp: "kb_diabetes_followup",
    asthmaReference: "kb_asthma_rescue",
    outreachPolicy: "kb_outreach_policy",
  },
  careTasks: {
    avaFollowUp: "task_fictional_ava_followup",
    marcusOutreach: "task_fictional_marcus_outreach",
  },
  agentRuns: {
    avaCoordinator: "run_fictional_ava_coordinator",
    avaReview: "run_fictional_ava_review",
  },
  agentEvents: {
    retrieveContext: "event_fictional_ava_retrieve",
    finish: "event_fictional_ava_finish",
  },
  approvals: {
    avaReferral: "approval_fictional_ava_referral",
  },
} as const;

export async function seedFictionalData(db = getDb()): Promise<void> {
  const repos = createRepositories(db);

  await upsertProvider(repos, {
    id: seedIds.providers.vargas,
    name: "Dr. Elena Vargas (FICTIONAL)",
    role: "physician",
  });
  await upsertProvider(repos, {
    id: seedIds.providers.blake,
    name: "Jordan Blake (FICTIONAL)",
    role: "care_coordinator",
  });
  await upsertProvider(repos, {
    id: seedIds.providers.okonkwo,
    name: "Samira Okonkwo, RN (FICTIONAL)",
    role: "nurse",
  });
  await upsertProvider(repos, {
    id: seedIds.providers.patel,
    name: "Chris Patel (FICTIONAL)",
    role: "reviewer",
  });

  await upsertPatient(repos, {
    id: seedIds.patients.ava,
    name: "Ava Nguyen (FICTIONAL)",
    dateOfBirth: "1978-06-21",
    conditions: [
      { name: "Type 2 diabetes mellitus", notes: "Fictional problem list entry" },
      { name: "Hypertension", notes: "Fictional problem list entry" },
    ],
    medications: [
      { name: "metformin", dosage: "500 mg", frequency: "twice daily" },
      { name: "lisinopril", dosage: "10 mg", frequency: "daily" },
    ],
  });
  await upsertPatient(repos, {
    id: seedIds.patients.marcus,
    name: "Marcus Hale (FICTIONAL)",
    dateOfBirth: "1991-11-03",
    conditions: [{ name: "Asthma", notes: "Fictional problem list entry" }],
    medications: [{ name: "albuterol", dosage: "90 mcg", frequency: "as needed" }],
  });
  await upsertPatient(repos, {
    id: seedIds.patients.priya,
    name: "Priya Shah (FICTIONAL)",
    dateOfBirth: "1955-02-14",
    conditions: [
      { name: "Heart failure", notes: "Fictional problem list entry" },
      { name: "Chronic kidney disease", notes: "Fictional problem list entry" },
    ],
    medications: [
      { name: "furosemide", dosage: "40 mg", frequency: "daily" },
      { name: "carvedilol", dosage: "12.5 mg", frequency: "twice daily" },
    ],
  });

  await upsertEncounter(repos, {
    id: seedIds.encounters.avaFollowUp,
    patientId: seedIds.patients.ava,
    providerId: seedIds.providers.vargas,
    occurredAt: new Date("2026-08-28T15:10:00.000Z"),
    transcript: [
      "FICTIONAL ENCOUNTER — not a real patient visit.",
      "Provider: Good afternoon. This is a scheduled follow-up after last week's unplanned clinic visit.",
      "Patient: The dizziness is better. I have been taking metformin and lisinopril as written.",
      "Provider: Blood pressure today is 138/86. Let's arrange care-coordination follow-up and review diabetes labs.",
    ].join("\n"),
  });
  await upsertEncounter(repos, {
    id: seedIds.encounters.marcusAsthma,
    patientId: seedIds.patients.marcus,
    providerId: seedIds.providers.okonkwo,
    occurredAt: new Date("2026-09-01T18:40:00.000Z"),
    transcript: [
      "FICTIONAL ENCOUNTER — not a real patient visit.",
      "Nurse: You used your rescue inhaler four times this week?",
      "Patient: Yes, mostly at night after walking the dog.",
      "Nurse: I will flag this for the care coordinator to schedule asthma education outreach.",
    ].join("\n"),
  });

  await ingestKnowledgeCorpus(fictionalKnowledgeCorpus, {
    documents: repos.clinicalDocuments,
    chunks: repos.documentChunks,
    embedder: createLexicalEmbedder(),
  });

  await upsertCareTask(repos, {
    id: seedIds.careTasks.avaFollowUp,
    patientId: seedIds.patients.ava,
    type: "follow_up",
    description: "Fictional 14-day diabetes follow-up after unplanned visit.",
    priority: "high",
    status: "pending_approval",
    assignedTo: seedIds.providers.blake,
  });
  await upsertCareTask(repos, {
    id: seedIds.careTasks.marcusOutreach,
    patientId: seedIds.patients.marcus,
    type: "outreach",
    description: "Fictional asthma education outreach after frequent inhaler use.",
    priority: "medium",
    status: "draft",
    assignedTo: seedIds.providers.blake,
  });

  await upsertAgentRun(repos, {
    id: seedIds.agentRuns.avaCoordinator,
    patientId: seedIds.patients.ava,
    agentName: "care_coordinator",
    status: "completed",
    startedAt: new Date("2026-08-28T16:00:00.000Z"),
    completedAt: new Date("2026-08-28T16:00:12.000Z"),
  });

  await upsertAgentEvent(repos, {
    id: seedIds.agentEvents.retrieveContext,
    agentRunId: seedIds.agentRuns.avaCoordinator,
    eventType: "tool_call",
    toolName: "retrieve_patient_context",
    input: { patientId: seedIds.patients.ava },
    output: { conditions: ["Type 2 diabetes mellitus", "Hypertension"] },
    timestamp: new Date("2026-08-28T16:00:03.000Z"),
  });
  await upsertAgentEvent(repos, {
    id: seedIds.agentEvents.finish,
    agentRunId: seedIds.agentRuns.avaCoordinator,
    eventType: "finish",
    output: { summary: "Fictional proposal: endocrinology referral pending approval." },
    timestamp: new Date("2026-08-28T16:00:11.000Z"),
  });

  await upsertApproval(repos, {
    id: seedIds.approvals.avaReferral,
    agentRunId: seedIds.agentRuns.avaCoordinator,
    status: "pending",
    action: {
      type: "propose_referral",
      payload: {
        patientId: seedIds.patients.ava,
        specialty: "endocrinology",
        note: "Fictional demo referral. Not a real order.",
      },
    },
    requestedAt: new Date("2026-08-28T16:00:11.000Z"),
  });

  await seedReviewFixture(db, {
    runId: seedIds.agentRuns.avaReview,
    patientId: seedIds.patients.ava,
  });
}

async function upsertProvider(
  repos: ReturnType<typeof createRepositories>,
  input: Parameters<typeof repos.providers.create>[0],
) {
  const existing = input.id ? await repos.providers.getById(input.id) : null;
  if (existing) {
    return existing;
  }
  return repos.providers.create(input);
}

async function upsertPatient(
  repos: ReturnType<typeof createRepositories>,
  input: Parameters<typeof repos.patients.create>[0],
) {
  const existing = input.id ? await repos.patients.getById(input.id) : null;
  if (existing) {
    return repos.patients.update(existing.id, {
      name: input.name,
      dateOfBirth: input.dateOfBirth,
      conditions: input.conditions,
      medications: input.medications,
    });
  }
  return repos.patients.create(input);
}

async function upsertEncounter(
  repos: ReturnType<typeof createRepositories>,
  input: Parameters<typeof repos.encounters.create>[0],
) {
  const existing = input.id ? await repos.encounters.getById(input.id) : null;
  if (existing) {
    return existing;
  }
  return repos.encounters.create(input);
}

async function upsertCareTask(
  repos: ReturnType<typeof createRepositories>,
  input: Parameters<typeof repos.careTasks.create>[0],
) {
  const existing = input.id ? await repos.careTasks.getById(input.id) : null;
  if (existing) {
    return repos.careTasks.update(existing.id, {
      type: input.type,
      description: input.description,
      priority: input.priority,
      status: input.status,
      assignedTo: input.assignedTo,
    });
  }
  return repos.careTasks.create(input);
}

async function upsertAgentRun(
  repos: ReturnType<typeof createRepositories>,
  input: Parameters<typeof repos.agentRuns.create>[0],
) {
  const existing = input.id ? await repos.agentRuns.getById(input.id) : null;
  if (existing) {
    return repos.agentRuns.update(existing.id, {
      status: input.status,
      completedAt: input.completedAt ?? null,
    });
  }
  return repos.agentRuns.create(input);
}

async function upsertAgentEvent(
  repos: ReturnType<typeof createRepositories>,
  input: Parameters<typeof repos.agentEvents.create>[0],
) {
  const existing = input.id ? await repos.agentEvents.getById(input.id) : null;
  if (existing) {
    return existing;
  }
  return repos.agentEvents.create(input);
}

async function upsertApproval(
  repos: ReturnType<typeof createRepositories>,
  input: Parameters<typeof repos.approvalRequests.create>[0],
) {
  const existing = input.id ? await repos.approvalRequests.getById(input.id) : null;
  if (existing) {
    return existing;
  }
  return repos.approvalRequests.create(input);
}

async function main() {
  const db = getDb();
  await seedFictionalData(db);
  await closeDb();
}

if (process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
