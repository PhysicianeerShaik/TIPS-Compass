import type { RiskLevel, RiskState } from "@/lib/types";

export type AlertItem = {
  id: string;
  level: RiskLevel;
  patientId: string;
  title: string;
  detail: string;
  lastCheckInDate?: string;
};

export type CheckInLite = {
  date: string;
  confusion: boolean;
  sleepReversal: boolean;
  tremor: boolean;
  bowelMovements: number;
  weightKg: number | null;
  bleeding: boolean;
  fever: boolean;
  medsTaken?: { lactulose?: boolean; rifaximin?: boolean; diuretics?: boolean };
};

export type PatientSummary = {
  headline: string;
  bullets: string[];
};

const levelRank: Record<RiskLevel, number> = {
  red: 0,
  yellow: 1,
  green: 2,
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function buildAlertFeed(items: RiskState[], limit = 6): AlertItem[] {
  const sorted = items
    .slice()
    .sort((a, b) => {
      const ra = levelRank[a.level];
      const rb = levelRank[b.level];
      if (ra !== rb) return ra - rb;
      return (b.lastCheckInDate ?? "").localeCompare(a.lastCheckInDate ?? "");
    })
    .filter((x) => x.level !== "green")
    .slice(0, limit);

  return sorted.map((x) => {
    const reasons = (x.reasons ?? []).slice(0, 2).join(" • ");
    return {
      id: `${x.patientId}-${x.level}-${x.lastCheckInDate ?? "na"}`,
      level: x.level,
      patientId: x.patientId,
      title: `${x.patientId} • ${x.level.toUpperCase()} risk`,
      detail: reasons || "No reasons captured",
      lastCheckInDate: x.lastCheckInDate,
    };
  });
}

export function buildDashboardSummary(items: RiskState[]) {
  const counts: Record<RiskLevel, number> = { red: 0, yellow: 0, green: 0 };
  const reasons: Record<string, number> = {};
  for (const x of items) {
    counts[x.level]++;
    for (const r of x.reasons ?? []) {
      reasons[r] = (reasons[r] ?? 0) + 1;
    }
  }

  const total = counts.red + counts.yellow + counts.green;
  const today = todayISO();
  const fresh = items.filter((x) => x.lastCheckInDate === today).length;
  const topReasons = Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => `${reason} (${count})`);

  const headline = total
    ? `${total} patients monitored`
    : "No live patients yet";
  const bullets = [
    counts.red
      ? `${counts.red} red-risk patients need immediate follow-up.`
      : "No red-risk patients right now.",
    counts.yellow
      ? `${counts.yellow} yellow-risk patients queued for review.`
      : "No yellow-risk backlog.",
    fresh
      ? `${fresh} check-ins received today.`
      : "No check-ins logged today.",
  ];

  if (topReasons.length > 0) {
    bullets.push(`Top signals: ${topReasons.join(" • ")}.`);
  }

  return { headline, bullets };
}

export function buildPatientSummary(
  patientId: string,
  risk: RiskState | null,
  checkins: CheckInLite[]
): PatientSummary {
  if (checkins.length === 0) {
    return {
      headline: `${patientId} has no check-ins yet`,
      bullets: ["Submit a check-in to start tracking risk trends."],
    };
  }

  const latest = checkins[0];
  const prev = checkins[1];

  const bullets: string[] = [];
  if (risk?.level) {
    const reasons = (risk.reasons ?? []).slice(0, 2).join(" • ");
    bullets.push(
      `Current risk: ${risk.level.toUpperCase()}${reasons ? ` (${reasons})` : ""}.`
    );
  }

  if (prev?.weightKg != null && latest.weightKg != null) {
    const delta = latest.weightKg - prev.weightKg;
    const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    bullets.push(
      `Weight is ${dir} ${Math.abs(delta).toFixed(1)} kg since last check-in.`
    );
  }

  if (prev) {
    const bmDelta = latest.bowelMovements - prev.bowelMovements;
    const bmDir = bmDelta > 0 ? "up" : bmDelta < 0 ? "down" : "steady";
    bullets.push(`Bowel movements are ${bmDir} vs. last check-in.`);
  }

  const neuroFlags = [
    latest.confusion ? "confusion" : null,
    latest.sleepReversal ? "sleep reversal" : null,
    latest.tremor ? "tremor" : null,
  ].filter(Boolean);
  if (neuroFlags.length > 0) {
    bullets.push(`Neuro signals present: ${neuroFlags.join(", ")}.`);
  }

  if (latest.bleeding || latest.fever) {
    bullets.push(
      `Urgent symptoms: ${[
        latest.bleeding ? "bleeding" : null,
        latest.fever ? "fever" : null,
      ]
        .filter(Boolean)
        .join(" • ")}.`
    );
  }

  const meds = latest.medsTaken ?? {};
  const medTaken = [meds.lactulose, meds.rifaximin, meds.diuretics].filter(
    (x) => x === true
  ).length;
  bullets.push(`Meds adherence today: ${medTaken}/3 doses reported.`);

  return {
    headline: `${patientId} • Latest check-in ${latest.date}`,
    bullets,
  };
}
