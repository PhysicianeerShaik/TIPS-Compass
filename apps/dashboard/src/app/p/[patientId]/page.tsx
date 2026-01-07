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
import { getDb } from "@/lib/firebase";
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

export default function PatientPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const router = useRouter();

  const [risk, setRisk] = useState<RiskState | null>(null);
  const [checkins, setCheckins] = useState<CheckIn[]>([]);
  const [actions, setActions] = useState<ClinicianAction[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!patientId) return;
    const db = getDb();

    // riskState
    const riskRef = doc(db, "riskStates", patientId);
    const unsubRisk = onSnapshot(
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

    const unsubCheckins = onSnapshot(
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

    const unsubActions = onSnapshot(
      aQuery,
      (snap) =>
        setActions(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as ClinicianAction) }))
        ),
      (e) => setErr(String(e))
    );

    return () => {
      unsubRisk();
      unsubCheckins();
      unsubActions();
    };
  }, [patientId]);

  const weightSeries = useMemo(() => {
    const vals = checkins
      .slice()
      .reverse()
      .map((c) => c.weightKg)
      .filter((w): w is number => typeof w === "number");
    return vals;
  }, [checkins]);

  const latest = checkins[0] ?? null;
  const summary = useMemo(
    () => buildPatientSummary(patientId ?? "patient", risk, checkins),
    [patientId, risk, checkins]
  );

  async function createQuickAction(type: ActionType) {
    if (!patientId) return;
    const db = getDb();

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
    const db = getDb();
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
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <div className="text-sm text-white/50">Weight trend</div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="text-2xl font-semibold">
                  {latest?.weightKg != null ? `${latest.weightKg.toFixed(1)} kg` : "—"}
                </div>
                <div className="text-white/60">
                  <Sparkline values={weightSeries} />
                </div>
              </div>
              <div className="mt-2 text-xs text-white/40">
                Last 30 check-ins (numeric weights only)
              </div>
            </Card>

            <Card>
              <div className="text-sm text-white/50">HE signals (latest)</div>
              <div className="mt-2 text-sm text-white/80 space-y-1">
                <div>
                  Confusion:{" "}
                  <span className="text-white/95">{latest ? fmtBool(latest.confusion) : "—"}</span>
                </div>
                <div>
                  Sleep reversal:{" "}
                  <span className="text-white/95">
                    {latest ? fmtBool(latest.sleepReversal) : "—"}
                  </span>
                </div>
                <div>
                  Tremor:{" "}
                  <span className="text-white/95">{latest ? fmtBool(latest.tremor) : "—"}</span>
                </div>
              </div>
            </Card>

            <Card>
              <div className="text-sm text-white/50">Meds adherence (latest)</div>
              <div className="mt-2 text-sm text-white/80 space-y-1">
                <div>
                  Lactulose:{" "}
                  <span className="text-white/95">
                    {latest ? fmtBool(latest.medsTaken?.lactulose) : "—"}
                  </span>
                </div>
                <div>
                  Rifaximin:{" "}
                  <span className="text-white/95">
                    {latest ? fmtBool(latest.medsTaken?.rifaximin) : "—"}
                  </span>
                </div>
                <div>
                  Diuretics:{" "}
                  <span className="text-white/95">
                    {latest ? fmtBool(latest.medsTaken?.diuretics) : "—"}
                  </span>
                </div>
              </div>
            </Card>
          </div>

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
