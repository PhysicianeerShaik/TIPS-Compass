import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ClinicianAction } from "@/lib/types";

export async function createAction(input: Omit<ClinicianAction, "id" | "createdAt" | "status"> & { status?: "open" | "done" }) {
  const { patientId, ...rest } = input;

  const ref = collection(db, "patients", patientId, "actions");
  const payload = {
    patientId,
    status: input.status ?? "open",
    createdAt: serverTimestamp(),
    createdBy: input.createdBy ?? "demo_clinician",
    ...rest,
  };

  await addDoc(ref, payload);
}

export async function markActionDone(patientId: string, actionId: string) {
  const ref = doc(db, "patients", patientId, "actions", actionId);
  await updateDoc(ref, { status: "done" });
}
