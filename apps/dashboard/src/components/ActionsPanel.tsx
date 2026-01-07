"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type { ClinicianAction, ActionType, ActionSeverity } from "@/lib/types";
import { createAction, markActionDone } from "@/lib/actions";

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white/70">
      {children}
    </span>
  );
}

function severityLabel(s: ActionSeverity) {
  return s === "urgent" ? "Urgent" : "Routine";
}

export function ActionsPanel({ patientId }: { patientId: string }) {
  const [items, setItems] = useState<ClinicianAction[]>([]);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [type, setType] = useState<ActionType>("call");
  const [severity, setSeverity] = useState<ActionSeverity>("routine");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const db = getDb();
    const ref = collection(db, "patients", patientId, "actions");
    const qy = query(ref, orderBy("createdAt", "desc"));
    return onSnapshot(qy, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ClinicianAction[];
      setItems(rows);
    });
  }, [patientId]);

  const openItems = useMemo(() => items.filter((x) => (x.status ?? "open") === "open"), [items]);
  const doneItems = useMemo(() => items.filter((x) => (x.status ?? "open") === "done"), [items]);

  async function onCreate() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await createAction({
        patientId,
        type,
        severity,
        title: title.trim(),
        details: details.trim(),
        createdBy: "demo_clinician",
      });
      setTitle("");
      setDetails("");
      setType("call");
      setSeverity("routine");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-panel-strong rounded-3xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-white/50">Clinician Actions</div>
          <div className="font-display mt-1 text-lg font-semibold tracking-tight">
            Plan & follow-through
          </div>
        </div>
        <Pill>{openItems.length} open</Pill>
      </div>

      {/* Composer */}
      <div className="mt-4 grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ActionType)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 outline-none focus:border-white/30"
          >
            <option value="call">Call</option>
            <option value="med_adjust">Medication adjust</option>
            <option value="ed_referral">ED referral</option>
            <option value="followup">Follow-up</option>
            <option value="note">Note</option>
          </select>

          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as ActionSeverity)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 outline-none focus:border-white/30"
          >
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Action title (e.g., Call patient re: confusion + low BMs)"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 placeholder:text-white/30 outline-none focus:border-white/30"
        />

        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Details / plan..."
          rows={3}
          className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 placeholder:text-white/30 outline-none focus:border-white/30"
        />

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCreate}
            disabled={busy || !title.trim()}
            className="rounded-full border border-white/10 bg-white/15 px-4 py-2 text-sm hover:bg-white/20 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Add action"}
          </button>
        </div>
      </div>

      {/* Lists */}
      <div className="mt-6">
        {openItems.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
            No open actions yet.
          </div>
        ) : (
          <div className="divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10">
            {openItems.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-4 p-4 hover:bg-white/[0.03]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold">{a.title}</div>
                    <Pill>{a.type}</Pill>
                    <Pill>{severityLabel(a.severity)}</Pill>
                  </div>
                  {a.details ? <div className="mt-2 text-sm text-white/60">{a.details}</div> : null}
                </div>
                <button
                  onClick={() => a.id && markActionDone(patientId, a.id)}
                  className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                >
                  Mark done
                </button>
              </div>
            ))}
          </div>
        )}

        {doneItems.length > 0 ? (
          <div className="mt-4 text-xs text-white/40">
            Done: {doneItems.length}
          </div>
        ) : null}
      </div>
    </div>
  );
}
