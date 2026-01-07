"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import Link from "next/link";

import { getDb } from "@/lib/firebase";
import { seedDemo } from "@/lib/demoSeed";

import type { RiskLevel, RiskState } from "@/lib/types";
import { buildAlertFeed, buildDashboardSummary } from "@/lib/insights";

import { Card } from "@/components/Card";
import { RiskBadge } from "@/components/Badge";
import { Segmented } from "@/components/Segmented";
import { ToastStack, type ToastItem } from "@/components/ToastStack";

type Filter = "all" | RiskLevel;

function levelRank(l: RiskLevel) {
  return l === "red" ? 0 : l === "yellow" ? 1 : 2;
}

export default function Dashboard() {
  const [items, setItems] = useState<RiskState[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [qText, setQText] = useState("");

  useEffect(() => {
    const db = getDb();
    const ref = collection(db, "riskStates");
    const qy = query(ref, orderBy("lastCheckInDate", "desc"));

    return onSnapshot(qy, (snap) => {
      const rows = snap.docs.map((d) => d.data() as RiskState);

      // Stable triage ordering: red → yellow → green, then newest check-in
      rows.sort((a, b) => {
        const ra = levelRank(a.level);
        const rb = levelRank(b.level);
        if (ra !== rb) return ra - rb;
        return (b.lastCheckInDate ?? "").localeCompare(a.lastCheckInDate ?? "");
      });

      setItems(rows);
    });
  }, []);

  const filtered = useMemo(() => {
    const t = qText.trim().toLowerCase();

    return items.filter((x) => {
      if (filter !== "all" && x.level !== filter) return false;
      if (!t) return true;

      const hay = `${x.patientId} ${(x.reasons ?? []).join(" ")}`.toLowerCase();
      return hay.includes(t);
    });
  }, [items, filter, qText]);

  const counts = useMemo(() => {
    const c: Record<RiskLevel, number> = { red: 0, yellow: 0, green: 0 };
    for (const x of items) c[x.level]++;
    return c;
  }, [items]);
  const totalCount = counts.red + counts.yellow + counts.green;

  const alerts = useMemo(() => buildAlertFeed(items), [items]);
  const summary = useMemo(() => buildDashboardSummary(items), [items]);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const redTotal = alerts.filter((a) => a.level === "red").length;
  const yellowTotal = alerts.filter((a) => a.level === "yellow").length;
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [showToasts, setShowToasts] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState({ red: 0, yellow: 0 });
  const unreadIdsRef = useRef<Set<string>>(new Set());
  const alertSeenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);

  useEffect(() => {
    if (!primedRef.current) {
      alerts.forEach((a) => alertSeenRef.current.add(a.id));
      primedRef.current = true;
      return;
    }

    const currentIds = new Set(alerts.map((a) => a.id));
    if (unreadIdsRef.current.size > 0) {
      for (const id of unreadIdsRef.current) {
        if (!currentIds.has(id)) unreadIdsRef.current.delete(id);
      }
    }

    if (!showToasts) {
      for (const a of alerts) {
        if (!alertSeenRef.current.has(a.id)) {
          unreadIdsRef.current.add(a.id);
        }
      }
      const unreadByLevel = { red: 0, yellow: 0 };
      for (const a of alerts) {
        if (unreadIdsRef.current.has(a.id)) {
          if (a.level === "red") unreadByLevel.red++;
          if (a.level === "yellow") unreadByLevel.yellow++;
        }
      }
      setUnreadCounts(unreadByLevel);
      return;
    }

    if (showToasts && unreadIdsRef.current.size > 0) {
      unreadIdsRef.current.clear();
      setUnreadCounts({ red: 0, yellow: 0 });
    }

    const next: ToastItem[] = [];
    for (const a of alerts) {
      if (alertSeenRef.current.has(a.id)) continue;
      alertSeenRef.current.add(a.id);
      next.push({
        id: `toast-${a.id}`,
        title: a.title,
        body: a.detail,
        tone: a.level === "red" ? "danger" : "warning",
      });
    }

    if (next.length > 0) {
      setToasts((prev) => [...next, ...prev].slice(0, 4));
    }
  }, [alerts, showToasts]);

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <main className="min-h-screen text-white">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-6 stagger">
          {/* Header */}
          <header className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.4em] text-white/50">
                  TIPS Compass
                </div>
                <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
                  Risk Command Center
                </h1>
                <p className="mt-2 max-w-2xl text-white/60">
                  Live triage from patient check-ins → Firestore → riskStates. Detect drift,
                  flag red-risk, and keep the care team in lockstep.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={seedDemo}
                  className="rounded-full border border-white/10 bg-white/10 px-5 py-2.5 text-sm text-white/90 shadow-[0_12px_28px_rgba(5,10,25,0.4)] hover:bg-white/15"
                >
                  Run demo scenario
                </button>

                <Link
                  className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-[0_16px_32px_rgba(246,182,99,0.25)] hover:opacity-90"
                  href="/checkin"
                >
                  Patient Check-In →
                </Link>
              </div>
            </div>

            <div className="glass-panel-strong relative overflow-hidden rounded-[32px] p-6 sm:p-8">
              <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />
              <div className="absolute -left-20 bottom-0 h-64 w-64 rounded-full bg-amber-400/10 blur-3xl" />
              <div className="relative grid gap-6 sm:grid-cols-[1.4fr_1fr]">
                <div>
                  <div className="text-xs uppercase tracking-[0.3em] text-white/50">
                    Live snapshot
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/70">
                      Streaming
                    </div>
                    <div className="text-sm text-white/50">
                      Last refresh: just now
                    </div>
                  </div>
                  <div className="mt-5 font-display text-3xl font-semibold">
                    {counts.red + counts.yellow + counts.green} active patients
                  </div>
                  <p className="mt-2 text-sm text-white/60">
                    Keep an eye on spikes in red-risk and medication adherence trends.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-white/50">
                      Red risk
                    </div>
                    <div className="mt-3 text-3xl font-semibold">{counts.red}</div>
                    <div className="mt-1 text-xs text-white/40">Escalate within 24 hrs</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-white/50">
                      Yellow risk
                    </div>
                    <div className="mt-3 text-3xl font-semibold">{counts.yellow}</div>
                    <div className="mt-1 text-xs text-white/40">Prioritize outreach</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:col-span-2">
                    <div className="text-xs uppercase tracking-[0.2em] text-white/50">
                      Latest signals
                    </div>
                    <div className="mt-3 text-sm text-white/70">
                      Confusion + 0 BMs • Bleeding • Fever spikes
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </header>

          {/* KPI cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <div className="text-sm text-white/50">Red</div>
              <div className="mt-2 text-3xl font-semibold">{counts.red}</div>
              <div className="mt-1 text-xs text-white/50">
                Immediate attention
              </div>
            </Card>
            <Card>
              <div className="text-sm text-white/50">Yellow</div>
              <div className="mt-2 text-3xl font-semibold">{counts.yellow}</div>
              <div className="mt-1 text-xs text-white/50">Watch closely</div>
            </Card>
            <Card>
              <div className="text-sm text-white/50">Green</div>
              <div className="mt-2 text-3xl font-semibold">{counts.green}</div>
              <div className="mt-1 text-xs text-white/50">Stable</div>
            </Card>
          </div>

          {/* Next-gen insights */}
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_0.9fr]">
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.3em] text-white/50">
                    Alert feed
                  </div>
                  <div className="mt-2 text-lg font-semibold">Escalations</div>
                  <div className="mt-1 text-xs text-white/40">
                    Live signals from Firestore subscriptions
                  </div>
                </div>
                <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/70">
                  Realtime
                </div>
              </div>

              <div className="mt-4 divide-y divide-white/10">
                {alerts.length === 0 ? (
                  <div className="py-6 text-sm text-white/50">
                    No urgent signals right now. Green patients are stable.
                  </div>
                ) : (
                  alerts.map((a) => (
                    <div key={a.id} className="flex items-start justify-between gap-4 py-4">
                      <div>
                        <div className="text-sm font-semibold">{a.title}</div>
                        <div className="mt-1 text-xs text-white/50">
                          {a.detail}
                        </div>
                      </div>
                      <div className="text-right text-xs text-white/40">
                        {a.lastCheckInDate ?? "—"}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <div className="text-xs uppercase tracking-[0.3em] text-white/50">
                Triage summary
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
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-white/50">
                AI-style insights are computed locally from incoming check-ins.
              </div>
            </Card>

            <Card>
              <div className="text-xs uppercase tracking-[0.3em] text-white/50">
                Trend radar
              </div>
              <div className="mt-3 text-2xl font-semibold">
                {totalCount === 0
                  ? "—"
                  : `${counts.red + counts.yellow}/${totalCount}`}
                <span className="text-sm text-white/50"> at risk</span>
              </div>
              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-white/50">
                    Red today
                  </div>
                  <div className="mt-2 text-xl font-semibold">
                    {items.filter((x) => x.level === "red" && x.lastCheckInDate === today).length}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-white/50">
                    Check-ins today
                  </div>
                  <div className="mt-2 text-xl font-semibold">
                    {items.filter((x) => x.lastCheckInDate === today).length}
                  </div>
                </div>
              </div>
              <div className="mt-4 text-xs text-white/50">
                Momentum updates in realtime as new riskStates arrive.
              </div>
            </Card>
          </div>

          {/* List */}
          <Card>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
                <Segmented<Filter>
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { label: "All", value: "all" },
                    { label: "Red", value: "red" },
                    { label: "Yellow", value: "yellow" },
                    { label: "Green", value: "green" },
                  ]}
                />

                <input
                  value={qText}
                  onChange={(e) => setQText(e.target.value)}
                  placeholder="Search patientId or reason…"
                  className="w-full sm:w-[320px] rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 placeholder:text-white/30 outline-none focus:border-white/20"
                />
              </div>

              <div className="text-xs text-white/40">
                Live updates via Firestore subscriptions
              </div>
            </div>

            <div className="mt-5 divide-y divide-white/10">
              {filtered.length === 0 ? (
                <div className="py-10 text-center text-white/50">
                  No patients yet. Submit a check-in to generate riskStates.
                </div>
              ) : (
                filtered.map((x) => (
                  <Link
                    key={x.patientId}
                    href={`/p/${encodeURIComponent(x.patientId)}`}
                    className="flex items-start justify-between gap-4 rounded-xl px-2 py-4 transition hover:bg-white/5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="text-lg font-semibold tracking-tight">
                          {x.patientId}
                        </div>
                        <RiskBadge level={x.level} />
                      </div>

                      <div className="mt-1 text-sm text-white/50">
                        Last check-in:{" "}
                        <span className="text-white/70">
                          {x.lastCheckInDate ?? "—"}
                        </span>
                      </div>

                      <div className="mt-2 line-clamp-2 text-sm text-white/70">
                        {(x.reasons ?? []).join(" • ")}
                      </div>
                    </div>

                    <div className="text-sm text-white/40">View →</div>
                  </Link>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
      <ToastStack toasts={showToasts ? toasts : []} onDismiss={dismissToast} />
      <button
        type="button"
        onClick={() => setShowToasts((v) => !v)}
        className="fixed right-4 top-4 z-50 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-[11px] uppercase tracking-[0.25em] text-white/70 shadow-[0_12px_28px_rgba(4,10,24,0.45)] hover:bg-white/15"
      >
        {showToasts ? "Hide alerts" : "Show alerts"}
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-300/30 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-100">
          R {redTotal}
          <span className="text-rose-100/70">/{unreadCounts.red}</span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
          Y {yellowTotal}
          <span className="text-amber-100/70">/{unreadCounts.yellow}</span>
        </span>
      </button>
    </main>
  );
}
