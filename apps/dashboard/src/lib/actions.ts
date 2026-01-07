import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { getAuthedDb } from "@/lib/firebase";
import type { ClinicianAction } from "@/lib/types";

export async function createAction(input: Omit<ClinicianAction, "id" | "createdAt" | "status"> & { status?: "open" | "done" }) {
  const { patientId, ...rest } = input;

  const db = await getAuthedDb();
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
  const db = await getAuthedDb();
  const ref = doc(db, "patients", patientId, "actions", actionId);
  await updateDoc(ref, { status: "done" });
}
