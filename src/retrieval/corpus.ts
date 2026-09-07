import type { ClinicalDocumentSource, KnowledgeTopic } from "@/lib/domain";

import { fictionalKnowledgeBody } from "./disclaimer";

export type KnowledgeDocumentDraft = {
  id: string;
  title: string;
  source: ClinicalDocumentSource;
  version: string;
  topics: KnowledgeTopic[];
  content: string;
};

export const fictionalKnowledgeCorpus: KnowledgeDocumentDraft[] = [
  {
    id: "kb_metformin_gi",
    title: "Fictional metformin gastrointestinal effects",
    source: "reference",
    version: "demo-1",
    topics: ["medication_side_effects", "diabetes"],
    content: fictionalKnowledgeBody(
      "In this fictional corpus, metformin is associated with stomach upset and loose stools when first started.",
      "A care coordinator may ask whether the fictional patient took the dose with food and may draft an education message. Medication changes require a human clinician.",
    ),
  },
  {
    id: "kb_lisinopril_cough",
    title: "Fictional lisinopril cough note",
    source: "reference",
    version: "demo-1",
    topics: ["medication_side_effects", "hypertension"],
    content: fictionalKnowledgeBody(
      "This demonstration text says a dry cough can appear after lisinopril is started in the fictional chart.",
      "The coordinator may flag a follow-up task. Stopping or substituting the drug is not an agent-authorized action.",
    ),
  },
  {
    id: "kb_furosemide_volume",
    title: "Fictional furosemide volume depletion note",
    source: "reference",
    version: "demo-1",
    topics: ["medication_side_effects", "heart_failure"],
    content: fictionalKnowledgeBody(
      "In the fictional heart-failure set, furosemide is linked to thirst, lightheadedness, and rapid weight drop.",
      "Care coordination may propose a same-week check-in. Dose changes stay with the human care team.",
    ),
  },
  {
    id: "kb_albuterol_tachycardia",
    title: "Fictional albuterol jitter and heart-rate note",
    source: "reference",
    version: "demo-1",
    topics: ["medication_side_effects", "asthma"],
    content: fictionalKnowledgeBody(
      "This fictional reference says rescue albuterol can cause shakiness and a faster heartbeat.",
      "Frequent inhaler use in the demo corpus is a reason to propose asthma education outreach, not to change the prescription automatically.",
    ),
  },
  {
    id: "kb_nutrition_sodium",
    title: "Fictional lower-sodium meal conversation",
    source: "knowledge_base",
    version: "demo-1",
    topics: ["nutrition", "hypertension", "heart_failure"],
    content: fictionalKnowledgeBody(
      "The fictional nutrition card suggests talking about restaurant soup, deli meat, and canned food as common sodium sources.",
      "It is a conversation prompt only. It does not prescribe a diet.",
    ),
  },
  {
    id: "kb_nutrition_carbs",
    title: "Fictional carbohydrate consistency card",
    source: "knowledge_base",
    version: "demo-1",
    topics: ["nutrition", "diabetes"],
    content: fictionalKnowledgeBody(
      "In this demo, coordinators may mention keeping carbohydrate amounts steadier across meals when a fictional patient has type 2 diabetes.",
      "No calorie target or meal plan is authorized by this text.",
    ),
  },
  {
    id: "kb_diabetes_followup",
    title: "Fictional diabetes follow-up interval",
    source: "guideline",
    version: "demo-1",
    topics: ["diabetes"],
    content: fictionalKnowledgeBody(
      "Adults with type 2 diabetes and an unplanned visit are flagged for care-coordination follow-up within 14 days in this fictional corpus.",
      "The interval is a demonstration rule for the agent evaluation suite, not a real quality measure.",
    ),
  },
  {
    id: "kb_diabetes_hypoglycemia",
    title: "Fictional low-glucose warning signs",
    source: "guideline",
    version: "demo-1",
    topics: ["diabetes", "care_escalation"],
    content: fictionalKnowledgeBody(
      "Sweating, confusion, or shakiness after insulin or a missed meal is treated as an urgent education moment in the fictional diabetes set.",
      "Severe symptoms are an escalation topic. The agent may only propose human review.",
    ),
  },
  {
    id: "kb_htn_home_log",
    title: "Fictional home blood-pressure logging",
    source: "guideline",
    version: "demo-1",
    topics: ["hypertension"],
    content: fictionalKnowledgeBody(
      "This fictional guideline asks coordinators to encourage a simple home blood-pressure log after an elevated clinic reading.",
      "It does not set a treatment threshold and does not start medication.",
    ),
  },
  {
    id: "kb_htn_missed_dose",
    title: "Fictional hypertension missed-dose conversation",
    source: "knowledge_base",
    version: "demo-1",
    topics: ["hypertension", "medication_adherence"],
    content: fictionalKnowledgeBody(
      "If a fictional patient missed lisinopril, the coordinator may ask when the last dose was taken and draft a reminder message.",
      "Doubling the next dose is out of scope for the agent.",
    ),
  },
  {
    id: "kb_fall_dizziness",
    title: "Fictional fall risk after dizziness",
    source: "guideline",
    version: "demo-1",
    topics: ["fall_risk"],
    content: fictionalKnowledgeBody(
      "New dizziness plus a recent medication start is a fall-risk flag in this fictional corpus.",
      "Home safety outreach or a nursing check-in may be proposed. Gait training orders are not auto-created.",
    ),
  },
  {
    id: "kb_fall_home_safety",
    title: "Fictional home safety talking points",
    source: "knowledge_base",
    version: "demo-1",
    topics: ["fall_risk", "patient_communication"],
    content: fictionalKnowledgeBody(
      "Night lights, clear walkways, and sitting before standing are the only home-safety points in this demonstration card.",
      "The text is for a drafted patient message, not an environmental assessment.",
    ),
  },
  {
    id: "kb_escalation_chest_pain",
    title: "Fictional chest-pain escalation card",
    source: "policy",
    version: "demo-1",
    topics: ["care_escalation"],
    content: fictionalKnowledgeBody(
      "Chest pain, sudden shortness of breath, or one-sided weakness is an immediate human-escalation topic in the fictional policy set.",
      "The agent must request human approval and must not tell a patient to stay home.",
    ),
  },
  {
    id: "kb_escalation_hypoglycemia",
    title: "Fictional severe hypoglycemia escalation",
    source: "policy",
    version: "demo-1",
    topics: ["care_escalation", "diabetes"],
    content: fictionalKnowledgeBody(
      "Inability to stay awake or repeated low-glucose events in the fictional chart requires notify-care-team approval.",
      "The model cannot close an escalation on its own.",
    ),
  },
  {
    id: "kb_comm_teachback",
    title: "Fictional teach-back communication card",
    source: "knowledge_base",
    version: "demo-1",
    topics: ["patient_communication"],
    content: fictionalKnowledgeBody(
      "Drafted messages in this corpus should ask the fictional patient to repeat the next step in their own words.",
      "Teach-back is a communication habit for the demo, not a clinical intervention.",
    ),
  },
  {
    id: "kb_comm_literacy",
    title: "Fictional plain-language outreach card",
    source: "knowledge_base",
    version: "demo-1",
    topics: ["patient_communication"],
    content: fictionalKnowledgeBody(
      "Use short sentences and avoid jargon such as 'titrate' or 'contraindicated' in fictional patient drafts.",
      "The card does not assess health literacy and does not diagnose confusion.",
    ),
  },
  {
    id: "kb_adherence_refill",
    title: "Fictional refill-window adherence card",
    source: "guideline",
    version: "demo-1",
    topics: ["medication_adherence"],
    content: fictionalKnowledgeBody(
      "If a chronic medication in the fictional chart would run out within seven days, the coordinator may open an outreach draft.",
      "Pharmacy orders and prior authorization are outside the tool catalog.",
    ),
  },
  {
    id: "kb_adherence_checkin",
    title: "Fictional adherence check-in script",
    source: "knowledge_base",
    version: "demo-1",
    topics: ["medication_adherence", "patient_communication"],
    content: fictionalKnowledgeBody(
      "A non-judgmental check-in asks how many doses were missed last week and what got in the way.",
      "The script is for a drafted message. It is not motivational interviewing therapy.",
    ),
  },
  {
    id: "kb_unplanned_visit",
    title: "Fictional post-unplanned-visit coordination",
    source: "guideline",
    version: "demo-1",
    topics: ["diabetes", "hypertension"],
    content: fictionalKnowledgeBody(
      "After an unplanned clinic visit, this fictional rule suggests reviewing medications, transportation, and the next scheduled touchpoint.",
      "It exists so retrieval tests can join diabetes and hypertension coordination language.",
    ),
  },
  {
    id: "kb_outreach_policy",
    title: "Fictional care-team outreach policy",
    source: "policy",
    version: "demo-1",
    topics: ["care_escalation", "patient_communication"],
    content: fictionalKnowledgeBody(
      "Notify-care-team and schedule-outreach actions are consequential in this demonstration policy.",
      "They require a pending approval record. The model cannot authorize them, skip approval, or send a message.",
    ),
  },
  {
    id: "kb_asthma_rescue",
    title: "Fictional frequent rescue-inhaler outreach",
    source: "guideline",
    version: "demo-1",
    topics: ["asthma"],
    content: fictionalKnowledgeBody(
      "Using a rescue inhaler more than twice a week in the fictional asthma chart is a reason to propose education outreach.",
      "Controller-inhaler changes are not performed by tools.",
    ),
  },
  {
    id: "kb_ckd_nsaid",
    title: "Fictional NSAID caution in chronic kidney disease",
    source: "reference",
    version: "demo-1",
    topics: ["medication_side_effects"],
    content: fictionalKnowledgeBody(
      "This fictional reference says over-the-counter pain pills in the NSAID class are a talking point when the chart lists chronic kidney disease.",
      "The agent may cite this card. It may not tell the patient to start or stop a drug.",
    ),
  },
  {
    id: "kb_hf_daily_weight",
    title: "Fictional daily-weight heart-failure card",
    source: "guideline",
    version: "demo-1",
    topics: ["heart_failure"],
    content: fictionalKnowledgeBody(
      "A two-pound overnight gain is a reason to propose a nurse check-in in this fictional heart-failure set.",
      "Diuretic adjustment remains a human decision.",
    ),
  },
  {
    id: "kb_no_show_outreach",
    title: "Fictional missed-appointment outreach",
    source: "policy",
    version: "demo-1",
    topics: ["patient_communication", "medication_adherence"],
    content: fictionalKnowledgeBody(
      "A missed visit in the fictional schedule may generate a drafted reschedule message after human approval.",
      "The agent does not discharge the patient or cancel future orders.",
    ),
  },
];

export const fictionalKnowledgeDocumentIds = fictionalKnowledgeCorpus.map((document) => document.id);
