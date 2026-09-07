import type { Repositories } from "@/lib/db/repositories";
import { createLexicalEmbedder } from "@/retrieval/embedder";
import { createKnowledgeSearch } from "@/retrieval/search";

import {
  createCreateCareTaskTool,
  createDraftPatientMessageTool,
  createGetCarePlanTool,
  createGetPatientContextTool,
  createGetRecentEncountersTool,
  createRequestHumanApprovalTool,
  createSearchClinicalKnowledgeTool,
} from "./definitions";
import { ToolRegistry } from "./registry";

export function createToolRegistry(repos: Repositories): ToolRegistry {
  const knowledgeSearch = createKnowledgeSearch({
    chunks: repos.documentChunks,
    embedder: createLexicalEmbedder(),
  });

  return new ToolRegistry()
    .register(createGetPatientContextTool(repos.patients))
    .register(createGetRecentEncountersTool(repos.encounters))
    .register(createGetCarePlanTool(repos.careTasks))
    .register(createSearchClinicalKnowledgeTool(knowledgeSearch))
    .register(createCreateCareTaskTool(repos.careTasks))
    .register(createDraftPatientMessageTool(repos.careTasks))
    .register(createRequestHumanApprovalTool(repos.approvalRequests));
}
