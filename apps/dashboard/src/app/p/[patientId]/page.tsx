"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  addDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getAuthedDb } from "@/lib/firebase";
import { Card } from "@/components/Card";
import { RiskBadge } from "@/components/Badge";
import type { RiskLevel, RiskState, ClinicianAction, ActionType, ActionSeverity } from "@/lib/types";
import { buildPatientSummary } from "@/lib/insights";

type CheckIn = {
  patientId: string;
  date: string; // YYYY-MM-DD
  confusion: boolean;
  sleepReversal: boolean;
  tremor: boolean;
  bowelMovements: number;
  weightKg: number | null;
  bleeding: boolean;
  fever: boolean;
  medsTaken: { lactulose: boolean; rifaximin: boolean; diuretics: boolean };
};

function fmtBool(v: boolean) {
  return v ? "Yes" : "No";
}

function levelToCopy(l: RiskLevel) {
  if (l === "red") return "Immediate attention";
  if (l === "yellow") return "Needs review";
  return "Stable";
}

function actionLabel(t: ActionType) {
  switch (t) {
    case "call":
      return "Call patient";
    case "med_adjust":
      return "Medication adjustment";
    case "ed_referral":
      return "ED referral";
    case "note":
      return "Add note";
    case "followup":
      return "Schedule follow-up";
    default:
      return t;
  }
}

function severityChip(s: ActionSeverity) {
  return s === "urgent" ? "URGENT" : "Routine";
}

function Sparkline({ values }: { values: number[] }) {
  const pts = useMemo(() => {
    if (values.length < 2) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const w = 140;
    const h = 36;
    const pad = 2;

    const norm = (v: number) => {
      if (max === min) return h / 2;
      return h - pad - ((v - min) / (max - min)) * (h - pad * 2);
    };

    return values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * (w - pad * 2) + pad;
        const y = norm(v);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [values]);

  if (!pts) return <div className="text-xs text-white/40">—</div>;

  return (
    <svg width="140" height="36" viewBox="0 0 140 36" className="opacity-90">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={pts} />
    </svg>
  );
}

function DetailedChart({
  label,
  unit,
  dates,
  values,
  formatValue,
}: {
  label: string;
  unit?: string;
  dates: string[];
  values: Array<number | null>;
  formatValue: (v: number | null) => string;
}) {
  const width = 720;
  const height = 340;
  const padX = 56;
  const padY = 44;
  const gridRows = 5;

  const numeric = values.filter((v): v is number => typeof v === "number");
  const hasData = numeric.length > 1;
  const min = hasData ? Math.min(...numeric) : 0;
  const max = hasData ? Math.max(...numeric) : 1;
  const avg = numeric.length > 0 ? numeric.reduce((a, b) => a + b, 0) / numeric.length : null;

  const segments = useMemo(() => {
    if (!hasData) return [];
    const segs: string[] = [];
    let current: string[] = [];

    values.forEach((v, i) => {
      if (typeof v !== "number") {
        if (current.length >= 2) segs.push(current.join(" "));
        current = [];
        return;
      }
      const x =
        (i / Math.max(1, values.length - 1)) * (width - padX * 2) + padX;
      const y =
        height -
        padY -
        ((v - min) / Math.max(1, max - min)) * (height - padY * 2);
      current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    });

    if (current.length >= 2) segs.push(current.join(" "));
    return segs;
  }, [hasData, values, width, height, padX, padY, min, max]);

  const gridLines = useMemo(() => {
    if (!hasData) return [];
    return Array.from({ length: gridRows + 1 }, (_, i) => {
      const y = height - padY - (i / gridRows) * (height - padY * 2);
      const val = min + (i / gridRows) * (max - min);
      return { y, val };
    });
  }, [hasData, gridRows, height, padY, min, max]);

  const exportCsv = () => {
    const rows = [["date", label.toLowerCase().replace(/\s+/g, "_")]];
    dates.forEach((d, i) => {
      const v = values[i];
      rows.push([d, v == null ? "" : String(v)]);
    });
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${label.toLowerCase().replace(/\s+/g, "_")}_trend.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-[#0b1424] p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-white/50">
            {label}
          </div>
          <div className="mt-2 text-lg font-semibold">
            Trend over time{unit ? ` (${unit})` : ""}
          </div>
          <div className="mt-1 text-xs text-white/50">
            Average:{" "}
            <span className="text-white/80">
              {avg == null ? "—" : formatValue(Number(avg.toFixed(2)))}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/70 hover:bg-white/15"
        >
          Export CSV
        </button>
      </div>
      <div className="mt-4 pb-6">
        {!hasData ? (
          <div className="py-6 text-sm text-white/50">Not enough data yet.</div>
        ) : (
          <svg
            width="100%"
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="text-white"
            preserveAspectRatio="none"
            style={{ overflow: "visible" }}
          >
            <rect x="0" y="0" width={width} height={height} fill="#0b1424" />
            {gridLines.map((g, idx) => (
              <g key={`grid-${idx}`}>
                <line
                  x1={padX}
                  y1={g.y}
                  x2={width - padX}
                  y2={g.y}
                  stroke="#1e2a3f"
                  strokeWidth="1"
                />
                <text
                  x={8}
                  y={g.y + 4}
                  fontSize="10"
                  fill="#c8d3ea"
                >
                  {g.val.toFixed(1)}
                </text>
              </g>
            ))}
            <line
              x1={padX}
              y1={padY}
              x2={padX}
              y2={height - padY}
              stroke="#c8d3ea"
              strokeWidth="1.5"
            />
            <line
              x1={padX}
              y1={height - padY}
              x2={width - padX}
              y2={height - padY}
              stroke="#c8d3ea"
              strokeWidth="1.5"
            />
            {segments.map((points, idx) => (
              <polyline
                key={`${label}-seg-${idx}`}
                fill="none"
                stroke="#f8f9ff"
                strokeWidth="2.5"
                points={points}
              />
            ))}
            {dates.map((d, i) => {
              const maxLabels = 10;
              const step = Math.max(1, Math.ceil(dates.length / maxLabels));
              if (i % step !== 0 && i !== dates.length - 1) return null;
              const x =
                (i / Math.max(1, dates.length - 1)) * (width - padX * 2) + padX;
              return (
                <text
                  key={`x-${d}-${i}`}
                  x={x}
                  y={height - 8}
                  fontSize="11"
                  textAnchor="end"
                  fill="#c8d3ea"
                  transform={`rotate(-25 ${x} ${height - 8})`}
                >
                  {d}
                </text>
              );
            })}
          </svg>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-white/40">
        <span>{dates[0] ?? "—"}</span>
        <span>{dates[dates.length - 1] ?? "—"}</span>
      </div>
      <div className="mt-5 max-h-48 overflow-auto rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-white/70">
        <div className="grid grid-cols-2 gap-2">
          {dates.map((d, i) => (
            <div key={`${label}-${d}-${i}`} className="flex items-center justify-between gap-3">
              <span className="text-white/50">{d}</span>
              <span className="text-white/80">{formatValue(values[i] ?? null)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  values,
  unit,
  onClick,
}: {
  label: string;
  value: string;
  values: number[];
  unit?: string;
  onClick?: () => void;
}) {
  return (
    <Card>
      <button
        type="button"
        onClick={onClick}
        className="group w-full text-left"
        aria-label={`Open ${label} trend`}
      >
        <div className="text-sm text-white/50">{label}</div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="text-2xl font-semibold">
            {value}
            {unit ? <span className="text-xs text-white/50"> {unit}</span> : null}
          </div>
          <div className="text-white/60">
            <Sparkline values={values} />
          </div>
        </div>
        <div className="mt-2 text-xs text-white/40 group-hover:text-white/60">
          Tap for full trend
        </div>
      </button>
    </Card>
  );
}

export default function PatientPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const router = useRouter();

  const [risk, setRisk] = useState<RiskState | null>(null);
  const [checkins, setCheckins] = useState<CheckIn[]>([]);
  const [actions, setActions] = useState<ClinicianAction[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [activeMetricId, setActiveMetricId] = useState<string | null>(null);

  useEffect(() => {
    if (!patientId) return;
    let unsubRisk = () => {};
    let unsubCheckins = () => {};
    let unsubActions = () => {};
    let active = true;

    (async () => {
      try {
        const db = await getAuthedDb();
        if (!active) return;
        // riskState
        const riskRef = doc(db, "riskStates", patientId);
        unsubRisk = onSnapshot(
          riskRef,
          (snap) => setRisk(snap.exists() ? (snap.data() as RiskState) : null),
          (e) => setErr(String(e))
        );

        // checkins
        const cRef = collection(db, "checkins");
        const cQuery = query(
          cRef,
          where("patientId", "==", patientId),
          orderBy("date", "desc"),
          limit(30)
        );

        unsubCheckins = onSnapshot(
          cQuery,
          (snap) => setCheckins(snap.docs.map((d) => d.data() as CheckIn)),
          (e) => setErr(String(e))
        );

        // clinician actions (Step 4)
        const aRef = collection(db, "clinicianActions");
        const aQuery = query(
          aRef,
          where("patientId", "==", patientId),
          orderBy("createdAt", "desc"),
          limit(50)
        );

        unsubActions = onSnapshot(
          aQuery,
          (snap) =>
            setActions(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as ClinicianAction) }))
            ),
          (e) => setErr(String(e))
        );
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    })();

    return () => {
      active = false;
      unsubRisk();
      unsubCheckins();
      unsubActions();
    };
  }, [patientId]);

  const orderedCheckins = useMemo(() => checkins.slice().reverse(), [checkins]);
  const dates = useMemo(() => orderedCheckins.map((c) => c.date), [orderedCheckins]);
  const weightValues = useMemo(
    () => orderedCheckins.map((c) => (typeof c.weightKg === "number" ? c.weightKg : null)),
    [orderedCheckins]
  );
  const weightSeries = useMemo(
    () => weightValues.filter((w): w is number => typeof w === "number"),
    [weightValues]
  );
  const bowelValues = useMemo(() => orderedCheckins.map((c) => c.bowelMovements), [orderedCheckins]);
  const medsValues = useMemo(() => {
    return orderedCheckins.map((c) => {
      const meds = c.medsTaken ?? {};
      return [meds.lactulose, meds.rifaximin, meds.diuretics].filter((x) => x === true).length;
    });
  }, [orderedCheckins]);
  const confusionValues = useMemo(
    () => orderedCheckins.map((c) => (c.confusion ? 1 : 0)),
    [orderedCheckins]
  );
  const sleepValues = useMemo(
    () => orderedCheckins.map((c) => (c.sleepReversal ? 1 : 0)),
    [orderedCheckins]
  );
  const tremorValues = useMemo(
    () => orderedCheckins.map((c) => (c.tremor ? 1 : 0)),
    [orderedCheckins]
  );
  const feverValues = useMemo(
    () => orderedCheckins.map((c) => (c.fever ? 1 : 0)),
    [orderedCheckins]
  );
  const bleedingValues = useMemo(
    () => orderedCheckins.map((c) => (c.bleeding ? 1 : 0)),
    [orderedCheckins]
  );

  const latest = checkins[0] ?? null;
  const metricItems = useMemo(() => {
    const latestMeds =
      latest == null
        ? null
        : [latest.medsTaken?.lactulose, latest.medsTaken?.rifaximin, latest.medsTaken?.diuretics].filter(
            (x) => x === true
          ).length;

    return [
      {
        id: "weight",
        label: "Weight",
        unit: "kg",
        dates,
        values: weightValues,
        sparkValues: weightSeries,
        latestLabel: latest?.weightKg != null ? latest.weightKg.toFixed(1) : "—",
        formatValue: (v: number | null) => (typeof v === "number" ? `${v.toFixed(1)} kg` : "—"),
      },
      {
        id: "bowel",
        label: "Bowel movements",
        dates,
        values: bowelValues,
        sparkValues: bowelValues,
        latestLabel: latest ? String(latest.bowelMovements) : "—",
        formatValue: (v: number | null) => (typeof v === "number" ? String(v) : "—"),
      },
      {
        id: "meds",
        label: "Meds adherence",
        unit: "/3",
        dates,
        values: medsValues,
        sparkValues: medsValues,
        latestLabel: latestMeds == null ? "—" : String(latestMeds),
        formatValue: (v: number | null) => (typeof v === "number" ? `${v}/3` : "—"),
      },
      {
        id: "confusion",
        label: "Confusion",
        dates,
        values: confusionValues,
        sparkValues: confusionValues,
        latestLabel: latest ? fmtBool(latest.confusion) : "—",
        formatValue: (v: number | null) => (v === 1 ? "Yes" : v === 0 ? "No" : "—"),
      },
      {
        id: "sleep",
        label: "Sleep reversal",
        dates,
        values: sleepValues,
        sparkValues: sleepValues,
        latestLabel: latest ? fmtBool(latest.sleepReversal) : "—",
        formatValue: (v: number | null) => (v === 1 ? "Yes" : v === 0 ? "No" : "—"),
      },
      {
        id: "tremor",
        label: "Tremor",
        dates,
        values: tremorValues,
        sparkValues: tremorValues,
        latestLabel: latest ? fmtBool(latest.tremor) : "—",
        formatValue: (v: number | null) => (v === 1 ? "Yes" : v === 0 ? "No" : "—"),
      },
      {
        id: "fever",
        label: "Fever",
        dates,
        values: feverValues,
        sparkValues: feverValues,
        latestLabel: latest ? fmtBool(latest.fever) : "—",
        formatValue: (v: number | null) => (v === 1 ? "Yes" : v === 0 ? "No" : "—"),
      },
      {
        id: "bleeding",
        label: "Bleeding",
        dates,
        values: bleedingValues,
        sparkValues: bleedingValues,
        latestLabel: latest ? fmtBool(latest.bleeding) : "—",
        formatValue: (v: number | null) => (v === 1 ? "Yes" : v === 0 ? "No" : "—"),
      },
    ];
  }, [
    dates,
    latest,
    weightValues,
    weightSeries,
    bowelValues,
    medsValues,
    confusionValues,
    sleepValues,
    tremorValues,
    feverValues,
    bleedingValues,
  ]);
  const metricById = useMemo(
    () => new Map(metricItems.map((m) => [m.id, m])),
    [metricItems]
  );
  const activeMetric = activeMetricId ? metricById.get(activeMetricId) ?? null : null;
  const summary = useMemo(
    () => buildPatientSummary(patientId ?? "patient", risk, checkins),
    [patientId, risk, checkins]
  );

  async function createQuickAction(type: ActionType) {
    if (!patientId) return;
    const db = await getAuthedDb();

    const urgent: ActionType[] = ["ed_referral"];
    const severity: ActionSeverity = urgent.includes(type) ? "urgent" : "routine";

    const title = actionLabel(type);
    const details =
      type === "ed_referral"
        ? "Recommend ED evaluation based on current risk signals."
        : "—";

    await addDoc(collection(db, "clinicianActions"), {
      patientId,
      type,
      severity,
      title,
      details,
      status: "open",
      createdAt: serverTimestamp(),
      createdBy: "demo_clinician",
    } satisfies ClinicianAction);
  }

  async function toggleActionDone(a: ClinicianAction) {
    if (!a.id) return;
    const db = await getAuthedDb();
    const ref = doc(db, "clinicianActions", a.id);
    await updateDoc(ref, { status: a.status === "done" ? "open" : "done" });
  }

  const openActions = actions.filter((a) => (a.status ?? "open") !== "done");
  const doneActions = actions.filter((a) => (a.status ?? "open") === "done");

  return (
    <main className="min-h-screen text-white">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-6">
          {/* Top bar */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.4em] text-white/50">
                Patient
              </div>
              <div className="mt-1 flex items-center gap-3">
                <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
                  {patientId}
                </h1>
                {risk?.level ? <RiskBadge level={risk.level} /> : null}
              </div>
              <div className="mt-2 text-white/60">
                Last check-in:{" "}
                <span className="text-white/75">
                  {risk?.lastCheckInDate ?? latest?.date ?? "—"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push("/")}
                className="rounded-full border border-white/10 bg-white/10 px-5 py-2.5 text-sm hover:bg-white/15"
              >
                ← Back
              </button>
              <button
                onClick={() =>
                  router.push(`/checkin?patientId=${encodeURIComponent(patientId)}`)
                }
                className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-[0_16px_32px_rgba(90,209,200,0.2)] hover:opacity-90"
              >
                New check-in →
              </button>
            </div>
          </div>

          {/* Error */}
          {err ? (
            <Card>
              <pre className="text-sm text-red-300 whitespace-pre-wrap">{err}</pre>
            </Card>
          ) : null}

          {/* Risk banner */}
          <Card>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm text-white/50">Current triage</div>
                <div className="mt-2 text-2xl font-semibold">
                  {risk?.level ? levelToCopy(risk.level) : "No riskState yet"}
                </div>
                <div className="mt-1 text-sm text-white/50">
                  Source: Cloud Function →{" "}
                  <span className="text-white/75">riskStates/{patientId}</span>
                </div>
              </div>

              <div className="sm:text-right">
                <div className="text-sm text-white/50">Reasons</div>
                <div className="mt-2 text-sm text-white/80">
                  {(risk?.reasons?.length ?? 0) > 0 ? risk!.reasons.join(" • ") : "—"}
                </div>
              </div>
            </div>
          </Card>

          {/* Next-gen summary */}
          <Card>
            <div className="text-xs uppercase tracking-[0.3em] text-white/50">
              Insight summary
            </div>
            <div className="mt-2 text-lg font-semibold">{summary.headline}</div>
            <div className="mt-4 space-y-2 text-sm text-white/70">
              {summary.bullets.map((b) => (
                <div key={b} className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-white/50" />
                  <span>{b}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Step 4: Clinician Actions */}
          <Card>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm text-white/50">Clinician actions</div>
                <div className="mt-1 text-lg font-semibold">Task list</div>
                <div className="mt-1 text-xs text-white/40">
                  Writes to <span className="text-white/60">clinicianActions</span> collection
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => createQuickAction("call")}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                >
                  + Call
                </button>
                <button
                  onClick={() => createQuickAction("med_adjust")}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                >
                  + Med adjust
                </button>
                <button
                  onClick={() => createQuickAction("followup")}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                >
                  + Follow-up
                </button>
                <button
                  onClick={() => createQuickAction("note")}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                >
                  + Note
                </button>
                <button
                  onClick={() => createQuickAction("ed_referral")}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                >
                  + ED referral
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Open</div>
                  <div className="text-xs text-white/40">{openActions.length}</div>
                </div>

                <div className="mt-3 divide-y divide-white/10">
                  {openActions.length === 0 ? (
                    <div className="py-6 text-sm text-white/50">No open tasks.</div>
                  ) : (
                    openActions.map((a) => (
                      <div key={a.id} className="py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-semibold">{a.title}</div>
                              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/70">
                                {severityChip(a.severity)}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-white/50">
                              Type: <span className="text-white/70">{a.type}</span>
                            </div>
                            <div className="mt-2 text-sm text-white/70 line-clamp-2">
                              {a.details || "—"}
                            </div>
                          </div>

                          <button
                            onClick={() => toggleActionDone(a)}
                            className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                          >
                            Mark done
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Done</div>
                  <div className="text-xs text-white/40">{doneActions.length}</div>
                </div>

                <div className="mt-3 divide-y divide-white/10">
                  {doneActions.length === 0 ? (
                    <div className="py-6 text-sm text-white/50">No completed tasks.</div>
                  ) : (
                    doneActions.map((a) => (
                      <div key={a.id} className="py-3 opacity-80">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-semibold line-through">{a.title}</div>
                              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/60">
                                {severityChip(a.severity)}
                              </span>
                            </div>
                            <div className="mt-2 text-sm text-white/60 line-clamp-1">
                              {a.details || "—"}
                            </div>
                          </div>

                          <button
                            onClick={() => toggleActionDone(a)}
                            className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                          >
                            Reopen
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Trend cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {metricItems.map((m) => (
              <MetricCard
                key={m.id}
                label={m.label}
                value={m.latestLabel}
                unit={m.unit}
                values={m.sparkValues}
                onClick={() => setActiveMetricId(m.id)}
              />
            ))}
          </div>

          {activeMetric ? (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
              onClick={() => setActiveMetricId(null)}
            >
              <div
                className="w-full max-w-4xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm text-white/60">Metric detail</div>
                  <button
                    type="button"
                    onClick={() => setActiveMetricId(null)}
                    className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/70 hover:bg-white/15"
                  >
                    Close
                  </button>
                </div>
                <DetailedChart
                  label={activeMetric.label}
                  unit={activeMetric.unit}
                  dates={activeMetric.dates}
                  values={activeMetric.values}
                  formatValue={activeMetric.formatValue}
                />
              </div>
            </div>
          ) : null}

          {/* Timeline */}
          <Card>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm text-white/50">Check-in timeline</div>
                <div className="mt-1 text-lg font-semibold">Recent submissions</div>
              </div>
              <div className="text-xs text-white/40">{checkins.length} items</div>
            </div>

            <div className="mt-5 divide-y divide-white/10">
              {checkins.length === 0 ? (
                <div className="py-10 text-center text-white/50">
                  No check-ins yet. Submit one to generate triage.
                </div>
              ) : (
                checkins.map((c) => (
                  <div key={`${c.patientId}_${c.date}`} className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-white/60">{c.date}</div>
                      <div className="text-xs text-white/40">
                        BMs: <span className="text-white/70">{c.bowelMovements}</span>
                        {" • "}
                        Weight:{" "}
                        <span className="text-white/70">
                          {c.weightKg == null ? "—" : `${c.weightKg.toFixed(1)} kg`}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 text-sm text-white/80">
                      HE:{" "}
                      <span className="text-white/70">
                        {c.confusion || c.sleepReversal || c.tremor
                          ? [
                              c.confusion ? "confusion" : null,
                              c.sleepReversal ? "sleep reversal" : null,
                              c.tremor ? "tremor" : null,
                            ]
                              .filter(Boolean)
                              .join(", ")
                          : "none"}
                      </span>
                      {" • "}
                      Fever: <span className="text-white/70">{fmtBool(c.fever)}</span>
                      {" • "}
                      Bleeding: <span className="text-white/70">{fmtBool(c.bleeding)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
