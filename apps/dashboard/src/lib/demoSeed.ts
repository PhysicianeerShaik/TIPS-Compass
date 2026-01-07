import { addDoc, collection, deleteDoc, doc, getDocs, query, where } from "firebase/firestore";
import { getAuthedDb } from "@/lib/firebase";
import { upsertRiskStateFromCheckin } from "@/lib/risk";

const today = new Date();
const demoPatients = ["patient_green", "patient_yellow", "patient_red"] as const;

function dateISO(daysAgo: number) {
  const d = new Date(today);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export async function seedDemo() {
  const db = await getAuthedDb();
  const base = {
    date: dateISO(0),
    sleepReversal: false,
    tremor: false,
    fever: false,
    medsTaken: { lactulose: true, rifaximin: true, diuretics: true },
  };

  async function addCheckInAndRisk(checkIn: Parameters<typeof upsertRiskStateFromCheckin>[1]) {
    await addDoc(collection(db, "checkins"), checkIn);
    await upsertRiskStateFromCheckin(db, checkIn);
  }

  const history: Parameters<typeof addCheckInAndRisk>[0][] = [];

  for (let i = 30; i >= 0; i -= 1) {
    const date = dateISO(i);

    history.push({
      ...base,
      date,
      patientId: "patient_green",
      confusion: false,
      sleepReversal: i % 12 === 0,
      tremor: i % 14 === 0,
      bowelMovements: clamp(3 + (i % 3) - 1, 2, 5),
      weightKg: 77 + (i % 5) * 0.2,
      bleeding: false,
      fever: i % 17 === 0,
    });

    history.push({
      ...base,
      date,
      patientId: "patient_yellow",
      confusion: i % 6 === 0,
      sleepReversal: i % 5 === 0,
      tremor: i % 7 === 0,
      bowelMovements: clamp(2 - (i % 2), 0, 2),
      weightKg: 80 + (i % 6) * 0.4,
      bleeding: i % 19 === 0,
      fever: i % 13 === 0,
    });

    history.push({
      ...base,
      date,
      patientId: "patient_red",
      confusion: i % 3 !== 0,
      sleepReversal: i % 4 === 0,
      tremor: i % 3 === 0,
      bowelMovements: clamp(1 - (i % 2), 0, 1),
      weightKg: 83 + (i % 8) * 0.5,
      bleeding: i % 5 === 0,
      fever: i % 6 === 0,
    });
  }

  await Promise.all(history.map((c) => addCheckInAndRisk(c)));
}

export async function clearDemoData() {
  const db = await getAuthedDb();

  const checkinsSnap = await getDocs(
    query(collection(db, "checkins"), where("patientId", "in", [...demoPatients]))
  );
  await Promise.all(checkinsSnap.docs.map((d) => deleteDoc(d.ref)));

  await Promise.all(
    demoPatients.map((patientId) => deleteDoc(doc(db, "riskStates", patientId)))
  );
}
