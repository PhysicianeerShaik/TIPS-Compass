export type RiskLevel = "green" | "yellow" | "red";

export type RiskState = {
  patientId: string;
  level: RiskLevel;
  reasons: string[];
  lastCheckInDate?: string;
};

export type ActionType =
  | "call"
  | "med_adjust"
  | "ed_referral"
  | "note"
  | "followup";

export type ActionSeverity = "routine" | "urgent";

export type ClinicianAction = {
  id?: string;
  patientId: string;
  type: ActionType;
  severity: ActionSeverity;
  title: string;
  details: string;
  status?: "open" | "done";
  createdBy?: string;
  createdAt?: any; // Firestore Timestamp
};
