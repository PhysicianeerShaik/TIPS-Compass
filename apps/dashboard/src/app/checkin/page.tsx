"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAuthedDb } from "@/lib/firebase";
import { Card } from "@/components/Card";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { clearDraft, loadDraft, saveDraft } from "@/lib/localDraft";
import { nowLocalTimeString, todayMMDDYYYY } from "@/lib/format";
import { upsertRiskStateFromCheckin } from "@/lib/risk";
import { GlobalFooter } from "@/components/GlobalFooter";

type CheckIn = {
  patientId: string;
  date: string; // MM-DD-YYYY
  confusion: boolean;
  sleepReversal: boolean;
  tremor: boolean;
  bowelMovements: number;
  weightKg: number | null;
  bleeding: boolean;
  fever: boolean;
  medsTaken: { lactulose: boolean; rifaximin: boolean; diuretics: boolean };
};

type Step = 0 | 1 | 2;

function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

function Toggle({
  label,
  hint,
  value,
  onChange,
  severity,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  severity?: "normal" | "warning" | "danger";
}) {
  const sev = severity ?? "normal";
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cx(
        "w-full rounded border px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-sm",
        value ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white hover:bg-gray-50",
        sev === "danger" && value && "border-red-300 bg-red-50",
        sev === "warning" && value && "border-amber-300 bg-amber-50"
      )}
      aria-pressed={value}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className={cx("text-sm font-medium", value ? "text-blue-900" : "text-slate-700")}>{label}</div>
          {hint ? <div className={cx("mt-0.5 text-xs", value ? "text-blue-700" : "text-slate-500")}>{hint}</div> : null}
        </div>

        <div
          className={cx(
            "h-5 w-9 rounded-full border p-0.5 transition-colors duration-200 ease-in-out",
            value ? "border-transparent bg-blue-600" : "border-gray-300 bg-gray-200"
          )}
          aria-hidden="true"
        >
          <div className={cx("h-3.5 w-3.5 rounded-full bg-white transition duration-200 ease-in-out", value ? "translate-x-4 shadow" : "translate-x-0 shadow-sm")} />
        </div>
      </div>
    </button>
  );
}

function Banner({
  kind,
  title,
  body,
}: {
  kind: "info" | "warning" | "danger" | "success";
  title: string;
  body?: string;
}) {
  const styles =
    kind === "danger"
      ? "border-red-200 bg-red-50 text-red-900"
      : kind === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : kind === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-blue-200 bg-blue-50 text-blue-900";

  return (
    <div className={cx("rounded border px-4 py-3 shadow-sm", styles)}>
      <div className="text-sm font-semibold">{title}</div>
      {body ? <div className="mt-1 text-xs opacity-80">{body}</div> : null}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const items = [
    { k: 0, label: "Neuro + symptoms" },
    { k: 1, label: "Vitals + bowel/weight" },
    { k: 2, label: "Meds + submit" },
  ] as const;

  return (
    <div className="flex items-center gap-2">
      {items.map((it, idx) => {
        const active = it.k === step;
        const done = it.k < step;
        return (
          <div key={it.k} className="flex items-center gap-2">
            <div
              className={cx(
                "h-6 w-6 rounded-full border text-xs flex items-center justify-center font-medium",
                done ? "border-blue-600 bg-blue-600 text-white" : active ? "border-blue-200 bg-blue-50 text-blue-700" : "border-gray-200 bg-gray-50 text-gray-400"
              )}
              aria-hidden="true"
            >
              {idx + 1}
            </div>
            <div className={cx("text-xs font-semibold uppercase tracking-wider", active ? "text-slate-900" : "text-slate-400")}>{it.label}</div>
            {idx !== items.length - 1 ? <div className="h-px w-4 bg-gray-200" aria-hidden="true" /> : null}
          </div>
        );
      })}
    </div>
  );
}

function validate(form: CheckIn) {
  const errors: Record<string, string> = {};
  if (!form.patientId.trim()) errors.patientId = "Patient ID is required.";
  if (!/^\d{2}-\d{2}-\d{4}$/.test(form.date)) errors.date = "Use MM-DD-YYYY.";
  if (form.bowelMovements < 0) errors.bowelMovements = "Must be 0 or more.";
  if (form.weightKg !== null && form.weightKg < 0) errors.weightKg = "Must be 0 or more.";
  return errors;
}

export default function CheckInPage() {
  const DRAFT_KEY = "tips_compass_checkin_draft_v1";

  const [step, setStep] = useState<Step>(0);
  const [touched, setTouched] = useState(false);

  const [form, setForm] = useState<CheckIn>({
    patientId: "patient_001",
    date: todayMMDDYYYY(),
    confusion: false,
    sleepReversal: false,
    tremor: false,
    bowelMovements: 2,
    weightKg: null,
    bleeding: false,
    fever: false,
    medsTaken: { lactulose: true, rifaximin: true, diuretics: true },
  });

  const [status, setStatus] = useState<
    { state: "idle" | "saving" | "saved" | "error"; msg?: string } | undefined
  >({ state: "idle" });

  const lastSaveRef = useRef<number>(0);

  // Load draft on mount
  useEffect(() => {
    const d = loadDraft<CheckIn>(DRAFT_KEY);
    if (d) setForm((p) => ({ ...p, ...d }));
  }, []);

  // Autosave draft (debounced)
  useEffect(() => {
    if (!touched) return;
    const now = Date.now();
    // save at most every 500ms
    if (now - lastSaveRef.current < 500) return;
    lastSaveRef.current = now;
    saveDraft(DRAFT_KEY, form);
  }, [form, touched]);

  const errors = useMemo(() => validate(form), [form]);
  const canSubmit = useMemo(() => Object.keys(errors).length === 0, [errors]);

  const checkinId = useMemo(() => {
    const pid = form.patientId.trim() || "unknown";
    return `${pid}_${form.date}`;
  }, [form.patientId, form.date]);

  // Red-flag logic for a safety banner
  const redFlags = useMemo(() => {
    const flags: string[] = [];
    if (form.bleeding) flags.push("Bleeding symptoms reported.");
    if (form.fever) flags.push("Fever reported.");
    if (form.confusion && form.bowelMovements === 0)
      flags.push("Confusion + 0 bowel movements (high HE concern).");
    return flags;
  }, [form]);

  function set<K extends keyof CheckIn>(k: K, v: CheckIn[K]) {
    setTouched(true);
    setForm((p) => ({ ...p, [k]: v }));
  }

  function next() {
    setTouched(true);
    if (step < 2) setStep((s) => ((s + 1) as Step));
  }

  function back() {
    setTouched(true);
    if (step > 0) setStep((s) => ((s - 1) as Step));
  }

  async function submit() {
    setTouched(true);
    if (!canSubmit) {
      setStatus({ state: "error", msg: "Please fix the highlighted fields." });
      return;
    }

    setStatus({ state: "saving" });
    try {
      const db = await getAuthedDb();
      const ref = doc(db, "checkins", checkinId);

      await setDoc(
        ref,
        {
          ...form,
          // EHR-ish metadata
          source: "dashboard-web",
          schemaVersion: 1,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(), // merge keeps existing; fine for emulator MVP
        },
        { merge: true }
      );
      await upsertRiskStateFromCheckin(db, form);

      clearDraft(DRAFT_KEY);

      setStatus({
        state: "saved",
        msg: `Submitted • ${nowLocalTimeString()} • checkins/${checkinId}`,
      });
    } catch (e: any) {
      setStatus({ state: "error", msg: String(e?.message ?? e) });
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 text-slate-900 pb-20">
      {/* Epic-style Top Navigation Header */}
      <header className="flex shrink-0 items-center justify-between bg-slate-900 px-4 py-2 text-white">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="font-display font-bold text-lg tracking-tight">TIPS<span className="text-blue-400">Compass</span></div>
          </div>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-400 md:flex">
            <Link href="/" className="transition hover:text-white">Patient List</Link>
            <span className="text-white">Device Check-In</span>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8">
        <header className="flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h1 className="text-2xl font-bold text-slate-900 leading-tight">
              Patient Flowsheet Entry
            </h1>
            <Link
              href="/"
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              Exit to Patient List
            </Link>
          </div>

          <div className="rounded border border-gray-200 bg-white p-6 shadow-sm">
            <div className="grid gap-6 sm:grid-cols-[1.2fr_1fr]">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Step {step + 1} of 3
                </div>
                <div className="mt-2">
                  <Stepper step={step} />
                </div>
                <div className="mt-4 text-xs text-slate-600 max-w-sm">
                  Patient responses help flag early warning signals for encephalopathy, bleeding, and infection.
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <div className="rounded border border-gray-200 bg-gray-50 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Est. Time
                  </div>
                  <div className="mt-1 text-xl font-bold text-slate-900">2 min</div>
                  <div className="mt-1 text-xs text-slate-500">Draft auto-saves</div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="mt-8 grid gap-4">
          {redFlags.length > 0 ? (
            <Banner
              kind="danger"
              title="Possible urgent symptoms detected"
              body="If symptoms are severe or rapidly worsening, seek urgent care now. Your submission will alert your care team in this demo."
            />
          ) : (
            <Banner
              kind="info"
              title="Draft auto-saves as you go"
              body="You can close this tab and come back—your inputs persist on this device."
            />
          )}

          <Card>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-slate-700">Patient ID</label>
                <input
                  value={form.patientId}
                  onChange={(e) => set("patientId", e.target.value)}
                  placeholder="patient_001"
                  className={cx(
                    "mt-1.5 w-full rounded border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-sm transition",
                    errors.patientId ? "border-red-300" : "border-gray-300"
                  )}
                />
                {errors.patientId ? (
                  <div className="mt-1.5 text-xs text-red-600 font-medium">{errors.patientId}</div>
                ) : (
                  <div className="mt-1.5 text-xs text-slate-500">Example: patient_001</div>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Date</label>
                <input
                  value={form.date}
                  onChange={(e) => set("date", e.target.value)}
                  className={cx(
                    "mt-1.5 w-full rounded border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-sm transition",
                    errors.date ? "border-red-300" : "border-gray-300"
                  )}
                />
                {errors.date ? (
                  <div className="mt-1.5 text-xs text-red-600 font-medium">{errors.date}</div>
                ) : (
                  <div className="mt-1.5 text-xs text-slate-500">
                    Writing to <span className="font-medium text-slate-700">checkins/{checkinId}</span>
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* STEP 0 */}
          {step === 0 ? (
            <Card>
              <div className="text-sm font-bold text-slate-900 border-b border-gray-100 pb-2 mb-4">Neuro + Symptoms</div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Toggle
                  label="Confusion"
                  hint="Trouble thinking clearly, disoriented, or unusually forgetful"
                  value={form.confusion}
                  onChange={(v) => set("confusion", v)}
                  severity="danger"
                />
                <Toggle
                  label="Sleep reversal"
                  hint="Sleeping during the day, awake at night"
                  value={form.sleepReversal}
                  onChange={(v) => set("sleepReversal", v)}
                  severity="warning"
                />
                <Toggle
                  label="Tremor"
                  hint="Shaky hands or difficulty with fine movements"
                  value={form.tremor}
                  onChange={(v) => set("tremor", v)}
                  severity="warning"
                />
                <Toggle
                  label="Bleeding"
                  hint="Blood in vomit/stool or concerning bleeding"
                  value={form.bleeding}
                  onChange={(v) => set("bleeding", v)}
                  severity="danger"
                />
                <Toggle
                  label="Fever"
                  hint="Feeling hot/chills or measured fever"
                  value={form.fever}
                  onChange={(v) => set("fever", v)}
                  severity="danger"
                />
              </div>

              {redFlags.length > 0 ? (
                <div className="mt-4 rounded border border-red-200 bg-red-50 p-4 shadow-sm">
                  <div className="text-sm font-bold text-red-900">Red flags</div>
                  <ul className="mt-2 list-disc pl-5 text-sm text-red-800">
                    {redFlags.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          ) : null}

          {/* STEP 1 */}
          {step === 1 ? (
            <Card>
              <div className="text-sm font-bold text-slate-900 border-b border-gray-100 pb-2 mb-4">Bowel Movements + Weight</div>
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Bowel movements today</label>
                  <input
                    type="number"
                    min={0}
                    value={form.bowelMovements}
                    onChange={(e) => set("bowelMovements", Number(e.target.value))}
                    className={cx(
                      "mt-1.5 w-full rounded border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-sm transition",
                      errors.bowelMovements ? "border-red-300" : "border-gray-300"
                    )}
                  />
                  {errors.bowelMovements ? (
                    <div className="mt-1.5 text-xs text-red-600 font-medium">{errors.bowelMovements}</div>
                  ) : (
                    <div className="mt-1.5 text-xs text-slate-500">
                      Low counts + neuro symptoms can indicate HE risk.
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700">Weight (kg) optional</label>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={form.weightKg ?? ""}
                    onChange={(e) =>
                      set("weightKg", e.target.value === "" ? null : Number(e.target.value))
                    }
                    placeholder="e.g., 78.4"
                    className={cx(
                      "mt-1.5 w-full rounded border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-sm transition",
                      errors.weightKg ? "border-red-300" : "border-gray-300"
                    )}
                  />
                  {errors.weightKg ? (
                    <div className="mt-1.5 text-xs text-red-600 font-medium">{errors.weightKg}</div>
                  ) : (
                    <div className="mt-1.5 text-xs text-slate-500">
                      Helps flag fluid overload trends.
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ) : null}

          {/* STEP 2 */}
          {step === 2 ? (
            <Card>
              <div className="text-sm font-bold text-slate-900 border-b border-gray-100 pb-2 mb-4">Medications</div>
              <div className="mt-2 text-xs text-slate-600">
                Mark what you took today. If you missed doses, your team may adjust the plan.
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Toggle
                  label="Lactulose"
                  value={form.medsTaken.lactulose}
                  onChange={(v) =>
                    setForm((p) => {
                      setTouched(true);
                      return { ...p, medsTaken: { ...p.medsTaken, lactulose: v } };
                    })
                  }
                />
                <Toggle
                  label="Rifaximin"
                  value={form.medsTaken.rifaximin}
                  onChange={(v) =>
                    setForm((p) => {
                      setTouched(true);
                      return { ...p, medsTaken: { ...p.medsTaken, rifaximin: v } };
                    })
                  }
                />
                <Toggle
                  label="Diuretics"
                  value={form.medsTaken.diuretics}
                  onChange={(v) =>
                    setForm((p) => {
                      setTouched(true);
                      return { ...p, medsTaken: { ...p.medsTaken, diuretics: v } };
                    })
                  }
                />
              </div>

              <div className="mt-6 rounded border border-gray-200 bg-gray-50 p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Review</div>
                <div className="mt-3 text-sm text-slate-700">
                  <div className="grid grid-cols-[100px_1fr] gap-1">
                    <span className="font-semibold text-slate-900">Patient:</span> <span>{form.patientId}</span>
                    <span className="font-semibold text-slate-900">Date:</span> <span>{form.date}</span>
                  </div>
                  <div className="mt-3 grid gap-1 border-t border-gray-200 pt-3">
                    <div>
                      <span className="font-semibold text-slate-900">Neuro:</span> Confusion: {String(form.confusion)} • Sleep reversal: {String(form.sleepReversal)} • Tremor: {String(form.tremor)}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">Vitals:</span> BMs: {form.bowelMovements} • Weight: {form.weightKg ?? "—"} kg
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">Other:</span> Bleeding: {String(form.bleeding)} • Fever: {String(form.fever)}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

          {/* Footer actions */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-t border-gray-200 pt-6 mt-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={back}
                disabled={step === 0}
                className={cx(
                  "rounded border px-5 py-2.5 text-sm font-medium transition shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20",
                  step === 0
                    ? "border-gray-200 bg-gray-50 text-gray-400"
                    : "border-gray-300 bg-white text-slate-700 hover:bg-gray-50"
                )}
              >
                Back
              </button>

              {step < 2 ? (
                <button
                  type="button"
                  onClick={next}
                  className="rounded bg-slate-900 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 transition focus:outline-none focus:ring-2 focus:ring-slate-900/20"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit || status?.state === "saving"}
                  className={cx(
                    "rounded px-6 py-2.5 text-sm font-medium shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500/20",
                    !canSubmit || status?.state === "saving"
                      ? "bg-gray-200 text-gray-500"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  )}
                >
                  {status?.state === "saving" ? "Submitting…" : "Submit check-in"}
                </button>
              )}
            </div>

            <div className="text-xs font-medium text-slate-500">
              {status?.state === "idle" ? (
                <>Draft saved automatically</>
              ) : status?.state === "saved" ? (
                <span className="text-emerald-600">{status.msg}</span>
              ) : status?.state === "error" ? (
                <span className="text-red-600">{status.msg}</span>
              ) : (
                <span className="text-slate-500">Submitting…</span>
              )}
            </div>
          </div>

          <div className="pt-2 text-xs font-semibold text-rose-600/80">
            If you have severe symptoms (heavy bleeding, fainting, severe confusion), call emergency services.
          </div>

          <div className="mt-8 rounded border border-rose-200 bg-rose-50 p-5 shadow-sm">
            <details className="group">
              <summary className="flex cursor-pointer items-center justify-between text-sm font-bold text-rose-900 outline-none focus:ring-2 focus:ring-rose-500/20 p-1 rounded">
                <span>Urgent TIPS warning signs — seek immediate care</span>
                <span className="text-rose-700 transition group-open:rotate-180">▼</span>
              </summary>
              <div className="mt-4 text-sm font-medium text-rose-800">
                <ul className="list-disc pl-5 space-y-1">
                  <li>Severe confusion, hard to wake, or sudden behavior changes</li>
                  <li>Vomiting blood or black/tarry stools</li>
                  <li>Fever, chills, or signs of infection</li>
                  <li>Worsening shortness of breath or chest pain</li>
                  <li>Severe abdominal pain or rapidly increasing belly size</li>
                  <li>No urine for many hours or very dark urine</li>
                </ul>
                <div className="mt-4 text-xs font-semibold text-rose-700">
                  If any of the above occur, call your care team or emergency services right away.
                </div>
              </div>
            </details>
          </div>

          <GlobalFooter />
        </div>
      </div>
    </main>
  );
}
