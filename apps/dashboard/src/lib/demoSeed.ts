import { addDoc, collection, deleteDoc, doc, getDocs, query, where } from "firebase/firestore";
import { getAuthedDb } from "@/lib/firebase";
import { evaluateRisk, upsertRiskStateFromCheckin } from "@/lib/risk";
import type { RiskState } from "@/lib/types";

const today = new Date();
const demoPatients = [
  "PT-10023", "PT-10045", "PT-10088", "PT-10091",
  "PT-10105", "PT-10112", "PT-10118", "PT-10122"
] as const;

function dateMDY(daysAgo: number) {
  const d = new Date(today);
  d.setDate(d.getDate() - daysAgo);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${yyyy}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function generateMockFrontendData() {
  const base = {
    sleepReversal: false,
    tremor: false,
    fever: false,
    medsTaken: { lactulose: true, rifaximin: true, diuretics: true },
  };

  const checkins: Parameters<typeof upsertRiskStateFromCheckin>[1][] = [];

  const patientProfiles = [
    { id: "PT-10023", type: "stable", weightBase: 77 },
    { id: "PT-10045", type: "watch", weightBase: 80 },
    { id: "PT-10088", type: "action", weightBase: 83 },
    { id: "PT-10091", type: "stable", weightBase: 65 },
    { id: "PT-10105", type: "action", weightBase: 92 },
    { id: "PT-10112", type: "stable", weightBase: 71 },
    { id: "PT-10118", type: "action", weightBase: 88 },
    { id: "PT-10122", type: "watch", weightBase: 75 },
  ];

  for (let i = 30; i >= 0; i -= 1) {
    const date = dateMDY(i);

    for (const p of patientProfiles) {
      let c;
      if (p.type === "stable") {
        c = {
          ...base, date, patientId: p.id,
          confusion: false, sleepReversal: i % 12 === 0, tremor: false,
          bowelMovements: clamp(3 + (i % 3) - 1, 2, 5),
          weightKg: p.weightBase + (i % 5) * 0.2,
          bleeding: false, fever: false,
        };
      } else if (p.type === "watch") {
        c = {
          ...base, date, patientId: p.id,
          confusion: i % 8 === 0, sleepReversal: i % 5 === 0, tremor: i % 7 === 0,
          bowelMovements: clamp(2 - (i % 2), 1, 3),
          weightKg: p.weightBase + (i % 6) * 0.4,
          bleeding: false, fever: i % 14 === 0,
        };
      } else {
        c = {
          ...base, date, patientId: p.id,
          confusion: i % 4 !== 0, sleepReversal: i % 3 === 0, tremor: i % 4 === 0,
          bowelMovements: clamp(1 - (i % 2), 0, 2),
          weightKg: p.weightBase + (i % 8) * 0.5,
          bleeding: i % 7 === 0, fever: i % 6 === 0,
        };
      }
      checkins.push(c);
    }
  }

  const riskStates: RiskState[] = patientProfiles.map((p) => {
    const pCheckins = checkins.filter((c) => c.patientId === p.id);
    const ordered = pCheckins.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const latest = ordered[0];
    const weightHistory = ordered
      .filter((c) => typeof c.weightKg === "number")
      .slice(0, 4)
      .map((c) => ({ date: c.date, weightKg: c.weightKg as number }));

    const { level, reasons } = evaluateRisk(latest, weightHistory);

    return {
      patientId: p.id,
      level,
      reasons,
      lastCheckInDate: latest.date,
    };
  });

  return { mockCheckins: checkins, mockRiskStates: riskStates };
}

export async function seedDemo() {
  const db = await getAuthedDb();
  const { mockCheckins } = generateMockFrontendData();

  async function addCheckInAndRisk(checkIn: Parameters<typeof upsertRiskStateFromCheckin>[1]) {
    await addDoc(collection(db, "checkins"), checkIn);
    await upsertRiskStateFromCheckin(db, checkIn);
  }

  await Promise.all(mockCheckins.map((c) => addCheckInAndRisk(c)));
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
