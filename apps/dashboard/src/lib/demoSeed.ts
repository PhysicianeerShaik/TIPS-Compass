import { addDoc, collection } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

const today = new Date().toISOString().slice(0, 10);

export async function seedDemo() {
  const db = getDb();
  const base = {
    date: today,
    sleepReversal: false,
    tremor: false,
    fever: false,
    medsTaken: { lactulose: true, rifaximin: true, diuretics: true },
  };

  await Promise.all([
    // GREEN
    addDoc(collection(db, "checkins"), {
      ...base,
      patientId: "patient_green",
      confusion: false,
      bowelMovements: 3,
      weightKg: 78,
      bleeding: false,
    }),
    // YELLOW
    addDoc(collection(db, "checkins"), {
      ...base,
      patientId: "patient_yellow",
      confusion: true,
      bowelMovements: 1,
      weightKg: 80,
      bleeding: false,
    }),
    // RED
    addDoc(collection(db, "checkins"), {
      ...base,
      patientId: "patient_red",
      confusion: true,
      bowelMovements: 0,
      weightKg: 83,
      bleeding: true,
    }),
  ]);
}
