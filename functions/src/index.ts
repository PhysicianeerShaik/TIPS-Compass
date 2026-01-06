import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();

type RiskLevel = "green" | "yellow" | "red";

type CheckIn = {
  // accept either patientId or patientID coming from Firestore
  patientId?: string;
  patientID?: string;

  date?: string; // YYYY-MM-DD
  confusion?: boolean;
  sleepReversal?: boolean;
  tremor?: boolean;
  bowelMovements?: number;
  weightKg?: number | null;
  bleeding?: boolean;
  fever?: boolean;
  medsTaken?: { lactulose?: boolean; rifaximin?: boolean; diuretics?: boolean };
};

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const rank: Record<RiskLevel, number> = { green: 0, yellow: 1, red: 2 };
  return rank[b] > rank[a] ? b : a;
}

async function getRecentWeights(patientId: string, upToDate: string) {
  const db = admin.firestore();
  const snap = await db
    .collection("checkins")
    .where("patientId", "==", patientId)
    .where("date", "<=", upToDate)
    .orderBy("date", "desc")
    .limit(4)
    .get();

  return snap.docs
    .map((d) => d.data() as any)
    .filter((x) => typeof x.weightKg === "number")
    .map((x) => ({ date: x.date as string, weightKg: x.weightKg as number }));
}

function evaluateRisk(
  checkIn: Required<
    Pick<
      CheckIn,
      | "date"
      | "confusion"
      | "sleepReversal"
      | "tremor"
      | "bowelMovements"
      | "weightKg"
      | "bleeding"
      | "fever"
      | "medsTaken"
    >
  >,
  weightHistory: { date: string; weightKg: number }[]
) {
  let level: RiskLevel = "green";
  const reasons: string[] = [];

  if (checkIn.bleeding) {
    level = maxRisk(level, "red");
    reasons.push("Bleeding symptoms reported");
  }

  if (checkIn.fever) {
    level = maxRisk(level, "red");
    reasons.push("Fever reported");
  }

  if (checkIn.confusion && checkIn.bowelMovements === 0) {
    level = maxRisk(level, "red");
    reasons.push("Severe HE concern: confusion + 0 bowel movements");
  }

  const neuro = checkIn.confusion || checkIn.sleepReversal || checkIn.tremor;
  if (neuro && checkIn.bowelMovements < 2) {
    level = maxRisk(level, "yellow");
    reasons.push("Possible hepatic encephalopathy");
  }

  if (weightHistory.length >= 2) {
    const newest = weightHistory[0];
    const oldest = weightHistory[weightHistory.length - 1];
    const delta = newest.weightKg - oldest.weightKg;
    if (delta >= 2.0) {
      level = maxRisk(level, "yellow");
      reasons.push(`Possible volume overload: +${delta.toFixed(1)} kg`);
    }
  }

  if (reasons.length === 0) {
    reasons.push("No concerning signals detected");
  }

  return { level, reasons };
}

export const onCheckInWrite = functions.firestore
  .document("checkins/{checkinId}")
  .onWrite(async (change) => {
    if (!change.after.exists) return;

    const raw = (change.after.data() || {}) as CheckIn;

    // normalize patientId field (supports patientID)
    const patientId = raw.patientId ?? raw.patientID;
    const date = raw.date;

    if (!patientId || !date) return;

    // normalize booleans/numbers so evaluateRisk never sees undefined
    const checkInNormalized = {
      date,
      confusion: !!raw.confusion,
      sleepReversal: !!raw.sleepReversal,
      tremor: !!raw.tremor,
      bowelMovements:
        typeof raw.bowelMovements === "number" ? raw.bowelMovements : 0,
      weightKg: typeof raw.weightKg === "number" ? raw.weightKg : null,
      bleeding: !!raw.bleeding,
      fever: !!raw.fever,
      medsTaken: {
        lactulose: !!raw.medsTaken?.lactulose,
        rifaximin: !!raw.medsTaken?.rifaximin,
        diuretics: !!raw.medsTaken?.diuretics,
      },
    };

    const weightHistory = await getRecentWeights(patientId, date);
    const { level, reasons } = evaluateRisk(checkInNormalized, weightHistory);

    await admin.firestore().collection("riskStates").doc(patientId).set(
      {
        patientId,
        level,
        reasons,
        lastCheckInDate: date,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
