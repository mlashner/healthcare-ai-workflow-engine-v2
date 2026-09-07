export const allowedRecommendationActionTypes = [
  "create_care_task",
  "draft_patient_message",
  "request_human_approval",
  "observe_only",
] as const;

export type AllowedRecommendationActionType = (typeof allowedRecommendationActionTypes)[number];

const allowed = new Set<string>(allowedRecommendationActionTypes);

export function isAllowedRecommendationAction(type: string): type is AllowedRecommendationActionType {
  return allowed.has(type);
}

export function actionRequiresHumanApproval(type: string): boolean {
  return type !== "observe_only";
}
