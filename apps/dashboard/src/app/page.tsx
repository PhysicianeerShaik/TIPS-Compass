"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import Link from "next/link";

import { getAuthedDb } from "@/lib/firebase";
import { generateMockFrontendData } from "@/lib/demoSeed";
import { evaluateRisk, type CheckInInput } from "@/lib/risk";

import type { RiskLevel, RiskState } from "@/lib/types";
import { buildAlertFeed, buildDashboardSummary } from "@/lib/insights";

import { Card } from "@/components/Card";
import { RiskBadge } from "@/components/Badge";
import { Segmented } from "@/components/Segmented";
import { ToastStack, type ToastItem } from "@/components/ToastStack";
import { GlobalFooter } from "@/components/GlobalFooter";

type Filter = "all" | RiskLevel;

function levelRank(l: RiskLevel) {
  return l === "red" ? 0 : l === "yellow" ? 1 : 2;
}

function TrendChart({
  dates,
  red,
  yellow,
  green,
}: {
  dates: string[];
  red: number[];
  yellow: number[];
  green: number[];
}) {
  const width = 420;
  const height = 140;
  const pad = 10;

  const maxVal = Math.max(1, ...red, ...yellow, ...green);
  const toPoints = (values: number[]) => {
    if (values.length < 2) return "";
    return values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * (width - pad * 2) + pad;
        const y = height - pad - (v / maxVal) * (height - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

  const redPts = toPoints(red);
  const yellowPts = toPoints(yellow);
  const greenPts = toPoints(green);

  return (
    <div className="w-full">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="text-slate-400"
        preserveAspectRatio="none"
      >
        <polyline fill="none" stroke="#f43f5e" strokeWidth="2.5" points={redPts} />
        <polyline fill="none" stroke="#fbbf24" strokeWidth="2.5" points={yellowPts} />
        <polyline fill="none" stroke="#10b981" strokeWidth="2.5" points={greenPts} />
      </svg>
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 font-medium">
        <span>{dates[0] ?? "—"}</span>
        <span>{dates[dates.length - 1] ?? "—"}</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [items, setItems] = useState<RiskState[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [qText, setQText] = useState("");
  const [checkins, setCheckins] = useState<CheckInInput[]>([]);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  useEffect(() => {
    if (demoEnabled) {
      const { mockCheckins, mockRiskStates } = generateMockFrontendData();

      const rows = [...mockRiskStates];
      rows.sort((a, b) => {
        const ra = levelRank(a.level);
        const rb = levelRank(b.level);
        if (ra !== rb) return ra - rb;
        const dateA = a.lastCheckInDate ? new Date(a.lastCheckInDate).getTime() : 0;
        const dateB = b.lastCheckInDate ? new Date(b.lastCheckInDate).getTime() : 0;
        return dateB - dateA;
      });

      setItems(rows);
      setCheckins(mockCheckins);
      return;
    }

    let unsubRisk = () => { };
    let unsubCheckins = () => { };
    let active = true;

    (async () => {
      try {
        const db = await getAuthedDb();
        if (!active) return;
        const ref = collection(db, "riskStates");
        const qy = query(ref, orderBy("lastCheckInDate", "desc"));

        unsubRisk = onSnapshot(qy, (snap) => {
          const rows = snap.docs.map((d) => d.data() as RiskState);

          // Stable triage ordering: red → yellow → green, then newest check-in
          rows.sort((a, b) => {
            const ra = levelRank(a.level);
            const rb = levelRank(b.level);
            if (ra !== rb) return ra - rb;
            const dateA = a.lastCheckInDate ? new Date(a.lastCheckInDate).getTime() : 0;
            const dateB = b.lastCheckInDate ? new Date(b.lastCheckInDate).getTime() : 0;
            return dateB - dateA;
          });

          setItems(rows);
        });

        const checkinsRef = collection(db, "checkins");
        const checkinsQuery = query(checkinsRef, orderBy("date", "asc"), limit(500));
        unsubCheckins = onSnapshot(checkinsQuery, (snap) => {
          setCheckins(snap.docs.map((d) => d.data() as CheckInInput));
        });
      } catch (err) {
        console.error("Firestore init failed", err);
      }
    })();

    return () => {
      active = false;
      unsubRisk();
      unsubCheckins();
    };
  }, [demoEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("tips_compass_demo_enabled");
    if (stored === "true") setDemoEnabled(true);
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

  const trend = useMemo(() => {
    const byPatient = new Map<string, CheckInInput[]>();
    for (const c of checkins) {
      if (!c.patientId || !c.date) continue;
      if (!byPatient.has(c.patientId)) byPatient.set(c.patientId, []);
      byPatient.get(c.patientId)!.push(c);
    }

    const dayCounts = new Map<string, { red: number; yellow: number; green: number }>();

    for (const [, list] of byPatient) {
      const ordered = list.slice().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      let weightHistory: { date: string; weightKg: number }[] = [];

      for (const c of ordered) {
        const nextHistory =
          typeof c.weightKg === "number"
            ? [...weightHistory, { date: c.date, weightKg: c.weightKg }]
            : weightHistory;
        const window = nextHistory.slice(-4);
        const { level } = evaluateRisk(c, window);
        if (!dayCounts.has(c.date)) {
          dayCounts.set(c.date, { red: 0, yellow: 0, green: 0 });
        }
        dayCounts.get(c.date)![level]++;
        weightHistory = nextHistory;
      }
    }

    const dates = Array.from(dayCounts.keys()).sort();
    return {
      dates,
      red: dates.map((d) => dayCounts.get(d)!.red),
      yellow: dates.map((d) => dayCounts.get(d)!.yellow),
      green: dates.map((d) => dayCounts.get(d)!.green),
    };
  }, [checkins]);

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

  const toggleDemo = () => {
    if (!demoEnabled) {
      setDemoEnabled(true);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("tips_compass_demo_enabled", "true");
      }
    } else {
      setDemoEnabled(false);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("tips_compass_demo_enabled", "false");
      }
    }
  };

  return (
    <main className="flex h-screen flex-col bg-gray-50 text-slate-900 overflow-hidden">
      {/* Epic-style Top Navigation Header */}
      <header className="flex shrink-0 items-center justify-between bg-slate-900 px-4 py-2 text-white">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="font-display font-bold text-lg tracking-tight">TIPS<span className="text-blue-400">Compass</span></div>
          </div>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-400 md:flex">
            <span className="text-white">Patient List</span>
            <Link href="/checkin" className="transition hover:text-white">Device Check-In</Link>
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm font-medium">
          <span className="hidden sm:inline-block text-slate-300">Dr. TIPSCompass</span>
          <button
            type="button"
            onClick={() => setShowToasts((v) => !v)}
            className="flex items-center gap-2 rounded bg-slate-800 px-3 py-1.5 text-xs transition hover:bg-slate-700"
          >
            {showToasts ? "Hide Alerts" : "Show Alerts"}
            {unreadCounts.red > 0 || unreadCounts.yellow > 0 ? (
              <span className="flex items-center gap-1.5 ml-1">
                {unreadCounts.red > 0 && <span className="h-2 w-2 rounded-full bg-rose-500" />}
                {unreadCounts.yellow > 0 && <span className="h-2 w-2 rounded-full bg-amber-500" />}
              </span>
            ) : null}
          </button>
          <button
            onClick={toggleDemo}
            disabled={demoBusy}
            className={`rounded bg-slate-800 px-3 py-1.5 text-xs transition hover:bg-slate-700 ${demoBusy ? "opacity-50" : ""}`}
          >
            {demoBusy ? "..." : demoEnabled ? "Demo: ON" : "Demo: OFF"}
          </button>
        </div>
      </header>

      {/* Clinical Ribbon / Department Snapshot */}
      <div className="flex shrink-0 flex-col gap-4 border-b border-gray-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
          <div className="flex justify-between sm:block">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Department Census</div>
            <div className="text-2xl font-bold text-slate-900">{items.length} <span className="text-sm font-normal text-slate-500">Total</span></div>
          </div>
          <div className="hidden sm:block h-10 w-px bg-gray-200" />
          <div className="flex justify-between sm:justify-start gap-4 sm:gap-6">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-rose-600">Action Required</div>
              <div className="text-xl font-bold text-rose-600">{counts.red}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Watch List</div>
              <div className="text-xl font-bold text-amber-600">{counts.yellow}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Stable</div>
              <div className="text-xl font-bold text-emerald-600">{counts.green}</div>
            </div>
          </div>
          <div className="hidden lg:block h-10 w-px bg-gray-200" />
          <div className="hidden lg:block max-w-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Triage AI Summary</div>
            <div className="truncate text-sm font-medium text-slate-700">{summary.headline}</div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row w-full lg:w-auto items-center gap-3 mt-2 lg:mt-0">
          <div className="w-full sm:w-auto flex justify-center">
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
          </div>
          <input
            value={qText}
            onChange={(e) => setQText(e.target.value)}
            placeholder="Search MRN or Reason..."
            className="w-full sm:w-64 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Patient Data Grid */}
        <div className="flex-1 overflow-x-hidden overflow-y-auto bg-white p-2 sm:p-4">
          <div className="w-full rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500 border-b border-gray-200 hidden sm:table-header-group">
                <tr>
                  <th className="px-3 sm:px-4 py-3">Patient MRN</th>
                  <th className="px-3 sm:px-4 py-3">Triage Level</th>
                  <th className="hidden md:table-cell px-4 py-3 w-1/3">Clinical Signals / Reasons</th>
                  <th className="hidden lg:table-cell px-4 py-3">Last Check-In</th>
                  <th className="px-3 sm:px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                      No patients found matching the criteria.
                    </td>
                  </tr>
                ) : (
                  filtered.map((x) => (
                    <tr key={x.patientId} className="group transition hover:bg-blue-50/50 flex flex-col sm:table-row border-b sm:border-b-0 border-gray-100 py-2 sm:py-0">
                      <td className="px-3 sm:px-4 py-1 sm:py-3 font-medium text-slate-900 flex justify-between sm:table-cell">
                        <span className="sm:hidden text-xs text-slate-500 uppercase font-semibold">MRN</span>
                        {x.patientId}
                      </td>
                      <td className="px-3 sm:px-4 py-1 sm:py-3 flex justify-between sm:table-cell">
                        <span className="sm:hidden text-xs text-slate-500 uppercase font-semibold">Triage</span>
                        <RiskBadge level={x.level} />
                      </td>
                      <td className="hidden md:table-cell px-4 py-3 text-slate-600 truncate max-w-sm">
                        {(x.reasons ?? []).join("; ") || "—"}
                      </td>
                      <td className="hidden lg:table-cell px-4 py-3 text-slate-500">
                        {x.lastCheckInDate ?? "—"}
                      </td>
                      <td className="px-3 sm:px-4 py-1 mt-2 sm:mt-0 sm:py-3 text-right sm:table-cell">
                        <Link
                          href={`/p/${encodeURIComponent(x.patientId)}`}
                          className="inline-block w-full sm:w-auto text-center rounded bg-blue-50 sm:bg-transparent px-3 py-2 sm:p-0 font-medium text-blue-600 hover:text-blue-800 sm:hover:underline"
                        >
                          Review →
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Layout for auxiliary components like Trend chart */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Risk Trend (Department-wide)</h3>
              <div className="mt-4">
                {trend.dates.length > 0 ? (
                  <TrendChart dates={trend.dates} red={trend.red} yellow={trend.yellow} green={trend.green} />
                ) : (
                  <div className="text-sm text-slate-400">No trend data.</div>
                )}
              </div>
            </Card>
            <Card>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Recent Escalations</h3>
                <span className="text-xs font-medium text-slate-400">Live feed</span>
              </div>
              <div className="mt-4 divide-y divide-gray-100">
                {alerts.length === 0 ? (
                  <div className="py-2 text-sm text-slate-500">No active escalations.</div>
                ) : (
                  alerts.slice(0, 4).map((a) => (
                    <div key={a.id} className="flex justify-between gap-4 py-2">
                      <div>
                        <div className="text-sm font-medium text-slate-900">{a.title}</div>
                        <div className="text-xs text-slate-600">{a.detail}</div>
                      </div>
                      <div className="text-xs text-slate-400 whitespace-nowrap">{a.lastCheckInDate}</div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
      <ToastStack toasts={showToasts ? toasts : []} onDismiss={dismissToast} />
    </main>
  );
}
