"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getDb } from "@/lib/firebase";
import { Card } from "@/components/Card";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { clearDraft, loadDraft, saveDraft } from "@/lib/localDraft";
import { nowLocalTimeString, todayYYYYMMDD } from "@/lib/format";

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
        "w-full rounded-2xl border px-4 py-4 text-left transition focus:outline-none focus:ring-2 focus:ring-white/20",
        value ? "border-white/25 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10",
        sev === "danger" && value && "border-red-300/40 bg-red-500/10",
        sev === "warning" && value && "border-yellow-300/40 bg-yellow-500/10"
      )}
      aria-pressed={value}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-white">{label}</div>
          {hint ? <div className="mt-1 text-xs text-white/50">{hint}</div> : null}
        </div>

        <div
          className={cx(
            "h-6 w-11 rounded-full border p-1 transition",
            value ? "border-white/30 bg-white/20" : "border-white/10 bg-white/5"
          )}
          aria-hidden="true"
        >
          <div className={cx("h-4 w-4 rounded-full bg-white transition", value ? "translate-x-5" : "translate-x-0")} />
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
      ? "border-red-300/30 bg-red-500/10"
      : kind === "warning"
      ? "border-yellow-300/30 bg-yellow-500/10"
      : kind === "success"
      ? "border-emerald-300/30 bg-emerald-500/10"
      : "border-white/10 bg-white/5";

  return (
    <div className={cx("rounded-2xl border px-4 py-3", styles)}>
      <div className="text-sm font-medium">{title}</div>
      {body ? <div className="mt-1 text-xs text-white/70">{body}</div> : null}
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
                "h-7 w-7 rounded-full border text-xs flex items-center justify-center",
                done ? "border-white/25 bg-white/20" : active ? "border-white/30 bg-white/10" : "border-white/10 bg-white/5"
              )}
              aria-hidden="true"
            >
              {idx + 1}
            </div>
            <div className={cx("text-xs", active ? "text-white" : "text-white/50")}>{it.label}</div>
            {idx !== items.length - 1 ? <div className="h-px w-6 bg-white/10" aria-hidden="true" /> : null}
          </div>
        );
      })}
    </div>
  );
}

function validate(form: CheckIn) {
  const errors: Record<string, string> = {};
  if (!form.patientId.trim()) errors.patientId = "Patient ID is required.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) errors.date = "Use YYYY-MM-DD.";
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
    date: todayYYYYMMDD(),
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
      const db = getDb();
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
    <main className="min-h-screen text-white">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.4em] text-white/50">
                TIPS Compass
              </div>
              <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
                Daily Check-In
              </h1>
              <p className="mt-2 text-white/60">
                Quick questions that help your care team triage early.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="rounded-full border border-white/10 bg-white/10 px-5 py-2.5 text-sm text-white/80 hover:bg-white/15"
              >
                Dashboard →
              </Link>
            </div>
          </div>

          <div className="glass-panel-strong relative overflow-hidden rounded-[32px] p-6 sm:p-8">
            <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-amber-400/10 blur-3xl" />
            <div className="absolute -left-20 bottom-0 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />
            <div className="relative grid gap-6 sm:grid-cols-[1.2fr_1fr]">
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-white/50">
                  Step {step + 1} of 3
                </div>
                <div className="mt-4">
                  <Stepper step={step} />
                </div>
                <div className="mt-5 text-sm text-white/60">
                  Your responses help flag early warning signals for encephalopathy,
                  bleeding, and infection risks.
                </div>
              </div>
              <div className="grid gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-white/50">
                    Estimated time
                  </div>
                  <div className="mt-3 text-3xl font-semibold">2 min</div>
                  <div className="mt-1 text-xs text-white/40">Draft auto-saves</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-white/50">
                    Safety note
                  </div>
                  <div className="mt-3 text-sm text-white/70">
                    Severe symptoms? Call emergency services immediately.
                  </div>
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
                <label className="text-xs text-white/50">Patient ID</label>
                <input
                  value={form.patientId}
                  onChange={(e) => set("patientId", e.target.value)}
                  placeholder="patient_001"
                  className={cx(
                    "mt-2 w-full rounded-2xl border bg-white/5 px-4 py-3 text-sm text-white/90 outline-none focus:border-white/20",
                    errors.patientId ? "border-red-300/40" : "border-white/10"
                  )}
                />
                {errors.patientId ? (
                  <div className="mt-2 text-xs text-red-300">{errors.patientId}</div>
                ) : (
                  <div className="mt-2 text-xs text-white/40">Example: patient_001</div>
                )}
              </div>

              <div>
                <label className="text-xs text-white/50">Date</label>
                <input
                  value={form.date}
                  onChange={(e) => set("date", e.target.value)}
                  className={cx(
                    "mt-2 w-full rounded-2xl border bg-white/5 px-4 py-3 text-sm text-white/90 outline-none focus:border-white/20",
                    errors.date ? "border-red-300/40" : "border-white/10"
                  )}
                />
                {errors.date ? (
                  <div className="mt-2 text-xs text-red-300">{errors.date}</div>
                ) : (
                  <div className="mt-2 text-xs text-white/40">
                    Writing to <span className="text-white/70">checkins/{checkinId}</span>
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* STEP 0 */}
          {step === 0 ? (
            <Card>
              <div className="text-sm font-medium">Neuro + symptoms</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
                <div className="mt-4 rounded-2xl border border-red-300/30 bg-red-500/10 p-4">
                  <div className="text-sm font-medium">Red flags</div>
                  <ul className="mt-2 list-disc pl-5 text-sm text-white/80">
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
              <div className="text-sm font-medium">Bowel movements + weight</div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-white/50">Bowel movements today</label>
                  <input
                    type="number"
                    min={0}
                    value={form.bowelMovements}
                    onChange={(e) => set("bowelMovements", Number(e.target.value))}
                    className={cx(
                      "mt-2 w-full rounded-2xl border bg-white/5 px-4 py-3 text-sm text-white/90 outline-none focus:border-white/20",
                      errors.bowelMovements ? "border-red-300/40" : "border-white/10"
                    )}
                  />
                  {errors.bowelMovements ? (
                    <div className="mt-2 text-xs text-red-300">{errors.bowelMovements}</div>
                  ) : (
                    <div className="mt-2 text-xs text-white/40">
                      Low counts + neuro symptoms can indicate HE risk.
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs text-white/50">Weight (kg) optional</label>
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
                      "mt-2 w-full rounded-2xl border bg-white/5 px-4 py-3 text-sm text-white/90 outline-none focus:border-white/20",
                      errors.weightKg ? "border-red-300/40" : "border-white/10"
                    )}
                  />
                  {errors.weightKg ? (
                    <div className="mt-2 text-xs text-red-300">{errors.weightKg}</div>
                  ) : (
                    <div className="mt-2 text-xs text-white/40">
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
              <div className="text-sm font-medium">Medications</div>
              <div className="mt-2 text-xs text-white/50">
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

              <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs text-white/50">Review</div>
                <div className="mt-2 text-sm text-white/80">
                  <div>Patient: <span className="text-white">{form.patientId}</span></div>
                  <div>Date: <span className="text-white">{form.date}</span></div>
                  <div className="mt-2 text-white/70">
                    Confusion: {String(form.confusion)} • Sleep reversal: {String(form.sleepReversal)} • Tremor: {String(form.tremor)}
                  </div>
                  <div className="text-white/70">
                    BMs: {form.bowelMovements} • Weight: {form.weightKg ?? "—"} kg
                  </div>
                  <div className="text-white/70">
                    Bleeding: {String(form.bleeding)} • Fever: {String(form.fever)}
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

          {/* Footer actions */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={back}
                disabled={step === 0}
                className={cx(
                  "rounded-full border px-5 py-3 text-sm transition",
                  step === 0
                    ? "border-white/10 bg-white/5 text-white/30"
                    : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                )}
              >
                Back
              </button>

              {step < 2 ? (
                <button
                  type="button"
                  onClick={next}
                  className="rounded-full bg-white px-6 py-3 text-sm font-medium text-black hover:opacity-90"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit || status?.state === "saving"}
                  className={cx(
                    "rounded-full px-6 py-3 text-sm font-medium transition",
                    !canSubmit || status?.state === "saving"
                      ? "bg-white/10 text-white/40"
                      : "bg-white text-black hover:opacity-90"
                  )}
                >
                  {status?.state === "saving" ? "Submitting…" : "Submit check-in"}
                </button>
              )}
            </div>

            <div className="text-xs text-white/60">
              {status?.state === "idle" ? (
                <>Draft saved automatically</>
              ) : status?.state === "saved" ? (
                <span className="text-emerald-300">{status.msg}</span>
              ) : status?.state === "error" ? (
                <span className="text-red-300">{status.msg}</span>
              ) : (
                <span className="text-white/60">Submitting…</span>
              )}
            </div>
          </div>

          <div className="pt-2 text-xs text-white/30">
            If you have severe symptoms (heavy bleeding, fainting, severe confusion), call emergency services.
          </div>
        </div>
      </div>
    </main>
  );
}
