"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onCheckInWrite = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
function maxRisk(a, b) {
    const rank = { green: 0, yellow: 1, red: 2 };
    return rank[b] > rank[a] ? b : a;
}
async function getRecentWeights(patientId, upToDate) {
    const db = admin.firestore();
    const snap = await db
        .collection("checkins")
        .where("patientId", "==", patientId)
        .where("date", "<=", upToDate)
        .orderBy("date", "desc")
        .limit(4)
        .get();
    return snap.docs
        .map((d) => d.data())
        .filter((x) => typeof x.weightKg === "number")
        .map((x) => ({ date: x.date, weightKg: x.weightKg }));
}
function evaluateRisk(checkIn, weightHistory) {
    let level = "green";
    const reasons = [];
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
exports.onCheckInWrite = functions.firestore
    .document("checkins/{checkinId}")
    .onWrite(async (change) => {
    if (!change.after.exists)
        return;
    const raw = (change.after.data() || {});
    // normalize patientId field (supports patientID)
    const patientId = raw.patientId ?? raw.patientID;
    const date = raw.date;
    if (!patientId || !date)
        return;
    // normalize booleans/numbers so evaluateRisk never sees undefined
    const checkInNormalized = {
        date,
        confusion: !!raw.confusion,
        sleepReversal: !!raw.sleepReversal,
        tremor: !!raw.tremor,
        bowelMovements: typeof raw.bowelMovements === "number" ? raw.bowelMovements : 0,
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
    await admin.firestore().collection("riskStates").doc(patientId).set({
        patientId,
        level,
        reasons,
        lastCheckInDate: date,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
});
