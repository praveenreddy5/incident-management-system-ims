import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import "./App.css";

type WorkItemState = "OPEN" | "INVESTIGATING" | "RESOLVED" | "CLOSED";
type Severity = "P0" | "P1" | "P2" | "P3";
type NavSection =
  | "dashboard"
  | "incidents"
  | "analytics"
  | "reports"
  | "rca-library"
  | "settings";

interface RCA {
  incidentStart: string;
  incidentEnd: string;
  rootCauseCategory: string;
  fixApplied: string;
  preventionSteps: string;
  submittedAt?: string;
}

interface Incident {
  id: string;
  componentId: string;
  componentType: string;
  title: string;
  severity: Severity;
  state: WorkItemState;
  firstSignalAt: string;
  lastSignalAt: string;
  endedAt: string | null;
  signalCount: number;
  mttrMinutes: number | null;
  rca: RCA | null;
}

interface RawSignal {
  _id: string;
  component_id: string;
  message: string;
  timestamp: string;
  received_at: string;
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3000",
});
const adminApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3000",
});
const viewerKey = import.meta.env.VITE_VIEWER_API_KEY || "viewer-demo-key";
const operatorKey = import.meta.env.VITE_OPERATOR_API_KEY || "operator-demo-key";
const adminKey = import.meta.env.VITE_ADMIN_API_KEY || "admin-demo-key";

/** Polling interval for timeseries + ops (and feed when SSE is off). */
const DASHBOARD_METRICS_POLL_MS = 4000;

api.interceptors.request.use((config) => {
  const method = String(config.method || "get").toLowerCase();
  const useOperator = method === "patch" || method === "post";
  config.headers["x-api-key"] = useOperator ? operatorKey : viewerKey;
  return config;
});
adminApi.interceptors.request.use((config) => {
  config.headers["x-api-key"] = adminKey;
  return config;
});

const rootCauseOptions = [
  "Capacity",
  "Deployment",
  "Configuration",
  "Dependency Failure",
  "Network",
  "Database",
  "Unknown",
];

function timeseriesMaxForPoints(points: Array<{ count: number }>): number {
  if (!points.length) return 1;
  return Math.max(1, ...points.map((p) => p.count));
}

/** Bar length as % of track; scales to max in the visible series so large counts do not overflow layout. */
function timeseriesBarWidthPercent(count: number, maxCount: number): string {
  const denom = Math.max(1, maxCount);
  if (count <= 0) return "0%";
  return `${Math.min(100, (count / denom) * 100)}%`;
}

function App() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [rcaLibraryIncidents, setRcaLibraryIncidents] = useState<Incident[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [rawSignals, setRawSignals] = useState<RawSignal[]>([]);
  const [timeseries, setTimeseries] = useState<Array<{ minute: string; count: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("");
  const [componentFilter, setComponentFilter] = useState<string>("");
  const [stateFilter, setStateFilter] = useState<string>("");
  const [activePage, setActivePage] = useState(1);
  const [activePageSize] = useState(20);
  const [activeTotal, setActiveTotal] = useState(0);
  const [signalPage, setSignalPage] = useState(1);
  const [signalPageSize] = useState(30);
  const [signalTotal, setSignalTotal] = useState(0);
  const [success, setSuccess] = useState<string | null>(null);
  const [queueDepth, setQueueDepth] = useState(0);
  const [dlqDepth, setDlqDepth] = useState(0);
  const [healthState, setHealthState] = useState<"ok" | "degraded">("ok");
  const [detailTab, setDetailTab] = useState<
    "overview" | "timeline" | "signals" | "metrics" | "related"
  >("overview");
  const [activeSection, setActiveSection] = useState<NavSection>("dashboard");
  const [rcaSeverityFilter, setRcaSeverityFilter] = useState<string>("");
  const [rcaCategoryFilter, setRcaCategoryFilter] = useState<string>("");
  const [rcaSearch, setRcaSearch] = useState<string>("");
  const [rcaLibrarySelectedId, setRcaLibrarySelectedId] = useState<string | null>(null);

  const [rcaForm, setRcaForm] = useState({
    incidentStart: "",
    incidentEnd: "",
    rootCauseCategory: "",
    fixApplied: "",
    preventionSteps: "",
  });

  const selectedState = useMemo(() => selected?.state ?? "OPEN", [selected]);
  const avgMttr = useMemo(() => {
    const values = incidents
      .map((item) => item.mttrMinutes)
      .filter((value): value is number => typeof value === "number");
    if (values.length === 0) return null;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }, [incidents]);
  const signalsPerMinute = useMemo(
    () => (timeseries.length > 0 ? timeseries[timeseries.length - 1].count : 0),
    [timeseries]
  );
  const timeseriesMaxCount = useMemo(() => timeseriesMaxForPoints(timeseries), [timeseries]);
  const recentTimeseriesPoints = useMemo(() => timeseries.slice(-20), [timeseries]);
  const recentTimeseriesMaxCount = useMemo(
    () => timeseriesMaxForPoints(recentTimeseriesPoints),
    [recentTimeseriesPoints]
  );
  const timelineEvents = useMemo(() => {
    if (!selected) return [];
    const events = [
      {
        time: formatClockTime(selected.firstSignalAt),
        title: "First signal received",
        detail: selected.componentType,
      },
      {
        time: formatClockTime(selected.firstSignalAt),
        title: "Work item created",
        detail: `Severity ${selected.severity}`,
      },
      {
        time: formatClockTime(selected.lastSignalAt),
        title: "Last signal seen",
        detail: `${selected.signalCount} signals aggregated`,
      },
    ];
    if (selected.endedAt) {
      events.push({
        time: formatClockTime(selected.endedAt),
        title: "Incident ended",
        detail: `State ${selected.state}`,
      });
    }
    if (selected.rca) {
      events.push({
        time: formatClockTime(selected.rca.incidentEnd),
        title: "RCA submitted",
        detail: selected.rca.rootCauseCategory,
      });
    }
    return events;
  }, [selected]);
  const relatedIncidents = useMemo(() => {
    if (!selected) return [];
    return incidents
      .filter(
        (item) =>
          item.id !== selected.id &&
          (item.componentType === selected.componentType ||
            item.severity === selected.severity)
      )
      .slice(0, 8);
  }, [incidents, selected]);
  const rcaCategoryOptions = useMemo(() => {
    return Array.from(
      new Set(
        rcaLibraryIncidents
          .filter((incident) => incident.rca)
          .map((incident) => incident.rca?.rootCauseCategory || "")
          .filter((value) => value.trim().length > 0)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [rcaLibraryIncidents]);
  const rcaHistoryItems = useMemo(() => {
    const query = rcaSearch.trim().toLowerCase();
    return rcaLibraryIncidents
      .filter((incident) => incident.rca)
      .filter((incident) => {
        if (rcaSeverityFilter && incident.severity !== rcaSeverityFilter) return false;
        if (
          rcaCategoryFilter &&
          (incident.rca?.rootCauseCategory || "").toLowerCase() !==
            rcaCategoryFilter.toLowerCase()
        ) {
          return false;
        }
        if (!query) return true;
        const componentMatch = incident.componentId.toLowerCase().includes(query);
        const categoryMatch = (incident.rca?.rootCauseCategory || "")
          .toLowerCase()
          .includes(query);
        return componentMatch || categoryMatch;
      })
      .sort((a, b) => {
        const aEnd = a.endedAt ? new Date(a.endedAt).getTime() : 0;
        const bEnd = b.endedAt ? new Date(b.endedAt).getTime() : 0;
        return bEnd - aEnd;
      });
  }, [rcaLibraryIncidents, rcaSeverityFilter, rcaCategoryFilter, rcaSearch]);
  const rcaLibrarySelectedIncident = useMemo(() => {
    if (!rcaLibrarySelectedId) return null;
    return (
      rcaLibraryIncidents.find(
        (incident) => incident.id === rcaLibrarySelectedId && incident.rca
      ) ?? null
    );
  }, [rcaLibraryIncidents, rcaLibrarySelectedId]);

  async function loadActive() {
    const params = new URLSearchParams({
      page: String(activePage),
      pageSize: String(activePageSize),
    });
    if (severityFilter) params.set("severity", severityFilter);
    if (componentFilter) params.set("componentId", componentFilter);
    if (stateFilter) params.set("state", stateFilter);
    params.set("groupByComponent", "true");
    const response = await api.get<{
      items: Incident[];
      pagination?: { total: number };
    }>(`/incidents/active?${params.toString()}`);
    setIncidents(response.data.items);
    setActiveTotal(response.data.pagination?.total ?? response.data.items.length);
    if (!selectedId && response.data.items.length > 0) {
      setSelectedId(response.data.items[0].id);
    }
  }

  async function loadTimeseries() {
    const response = await api.get<{ points: Array<{ minute: string; count: number }> }>(
      "/incidents/aggregations/timeseries?minutes=60"
    );
    setTimeseries(response.data.points);
  }

  async function loadRcaLibrary() {
    const [resolvedResp, closedResp] = await Promise.all([
      api.get<{ items: Incident[] }>(
        "/incidents/active?page=1&pageSize=200&groupByComponent=false&state=RESOLVED"
      ),
      api.get<{ items: Incident[] }>(
        "/incidents/active?page=1&pageSize=200&groupByComponent=false&state=CLOSED"
      ),
    ]);
    const merged = [...resolvedResp.data.items, ...closedResp.data.items];
    const map = new Map<string, Incident>();
    for (const incident of merged) {
      if (incident.rca) map.set(incident.id, incident);
    }
    setRcaLibraryIncidents(Array.from(map.values()));
  }

  async function loadIncidentDetail(id: string) {
    const response = await api.get<{
      incident: Incident;
      rawSignals: RawSignal[];
      pagination?: { total: number };
    }>(`/incidents/${id}?page=${signalPage}&pageSize=${signalPageSize}`);
    setSelected(response.data.incident);
    setRawSignals(response.data.rawSignals);
    setSignalTotal(response.data.pagination?.total ?? response.data.rawSignals.length);
    if (response.data.incident.rca) {
      setRcaForm({
        incidentStart: toInputDateTime(response.data.incident.rca.incidentStart),
        incidentEnd: toInputDateTime(response.data.incident.rca.incidentEnd),
        rootCauseCategory: response.data.incident.rca.rootCauseCategory,
        fixApplied: response.data.incident.rca.fixApplied,
        preventionSteps: response.data.incident.rca.preventionSteps,
      });
    } else {
      setRcaForm({
        incidentStart: toInputDateTime(response.data.incident.firstSignalAt),
        incidentEnd: toInputDateTime(
          response.data.incident.endedAt || response.data.incident.lastSignalAt
        ),
        rootCauseCategory: "",
        fixApplied: "",
        preventionSteps: "",
      });
    }
  }

  async function loadOperationalSnapshot() {
    try {
      const [healthResp, queueResp] = await Promise.all([
        api.get<{ status: "ok" | "degraded" }>("/health"),
        adminApi.get<{
          mainQueue: { waiting?: number; active?: number; delayed?: number };
          deadLetterQueue: { waiting?: number; active?: number; delayed?: number };
        }>("/incidents/ops/queue"),
      ]);
      setHealthState(healthResp.data.status);
      const queueTotal =
        (queueResp.data.mainQueue.waiting ?? 0) +
        (queueResp.data.mainQueue.active ?? 0) +
        (queueResp.data.mainQueue.delayed ?? 0);
      const dlqTotal =
        (queueResp.data.deadLetterQueue.waiting ?? 0) +
        (queueResp.data.deadLetterQueue.active ?? 0) +
        (queueResp.data.deadLetterQueue.delayed ?? 0);
      setQueueDepth(queueTotal);
      setDlqDepth(dlqTotal);
    } catch {
      setHealthState("degraded");
      setQueueDepth(0);
      setDlqDepth(0);
    }
  }

  async function refreshDashboard() {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadActive(), loadTimeseries(), loadRcaLibrary()]);
      // Ops cards should not block primary dashboard data.
      await loadOperationalSnapshot();
      if (selectedId && activeSection !== "rca-library") {
        await loadIncidentDetail(selectedId);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const dashboardMetricsRef = useRef({
    loadTimeseries,
    loadOperationalSnapshot,
    loadActive,
  });
  dashboardMetricsRef.current = {
    loadTimeseries,
    loadOperationalSnapshot,
    loadActive,
  };

  const dashboardPollContextRef = useRef({
    activeSection,
    sseEnabled: false,
  });
  dashboardPollContextRef.current = {
    activeSection,
    sseEnabled:
      !severityFilter && !componentFilter && !stateFilter && activePage === 1,
  };

  useEffect(() => {
    refreshDashboard();
  }, [activePage, severityFilter, componentFilter, stateFilter]);

  useEffect(() => {
    if (activeSection !== "dashboard" && activeSection !== "analytics") {
      return;
    }

    const tick = () => {
      const m = dashboardMetricsRef.current;
      const ctx = dashboardPollContextRef.current;
      void Promise.all([m.loadTimeseries(), m.loadOperationalSnapshot()]).catch((err) =>
        setError(getErrorMessage(err))
      );
      if (ctx.activeSection === "dashboard" && !ctx.sseEnabled) {
        void m.loadActive().catch((err) => setError(getErrorMessage(err)));
      }
      if (ctx.activeSection === "analytics") {
        void m.loadActive().catch((err) => setError(getErrorMessage(err)));
      }
    };

    tick();
    const id = window.setInterval(tick, DASHBOARD_METRICS_POLL_MS);
    return () => window.clearInterval(id);
  }, [activeSection]);

  useEffect(() => {
    const sseEnabled =
      !severityFilter && !componentFilter && !stateFilter && activePage === 1;
    if (!sseEnabled) return;

    const streamBase = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3000";
    const stream = new EventSource(
      `${streamBase}/incidents/stream?apiKey=${encodeURIComponent(viewerKey)}`
    );
    stream.addEventListener("active_incidents", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        items: Incident[];
        total: number;
      };
      const unique = dedupeByComponent(payload.items)
        .sort(
          (a, b) =>
            severityScore(a.severity) - severityScore(b.severity) ||
            new Date(b.lastSignalAt).getTime() - new Date(a.lastSignalAt).getTime()
        );
      setIncidents(unique.slice(0, activePageSize));
      setActiveTotal(payload.total);
    });
    stream.onerror = () => {
      setError("Live stream disconnected. Using manual refresh.");
    };
    return () => stream.close();
  }, [severityFilter, componentFilter, stateFilter, activePage, activePageSize]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(activeTotal / activePageSize));
    if (activePage > totalPages) {
      setActivePage(totalPages);
    }
  }, [activeTotal, activePage, activePageSize]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(signalTotal / signalPageSize));
    if (signalPage > totalPages) {
      setSignalPage(totalPages);
    }
  }, [signalTotal, signalPage, signalPageSize]);

  useEffect(() => {
    if (!selectedId) return;
    if (activeSection === "rca-library") return;
    loadIncidentDetail(selectedId).catch((err) => setError(getErrorMessage(err)));
  }, [selectedId, signalPage, activeSection]);

  useEffect(() => {
    if (activeSection === "rca-library") return;

    if (incidents.length === 0) {
      setSelectedId(null);
      setSelected(null);
      setRawSignals([]);
      return;
    }

    const selectedStillVisible = selectedId
      ? incidents.some((incident) => incident.id === selectedId)
      : false;
    if (!selectedStillVisible) {
      setSelectedId(incidents[0].id);
      setSignalPage(1);
    }
  }, [incidents, selectedId, activeSection]);

  async function handleStateChange(nextState: WorkItemState) {
    if (!selectedId) return;
    setError(null);
    setSuccess(null);
    try {
      await api.patch(`/incidents/${selectedId}/state`, { state: nextState });
      setSuccess(`State updated to ${nextState}`);
      await refreshDashboard();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function submitRca() {
    if (!selectedId) return;
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/incidents/${selectedId}/rca`, {
        incidentStart: new Date(rcaForm.incidentStart).toISOString(),
        incidentEnd: new Date(rcaForm.incidentEnd).toISOString(),
        rootCauseCategory: rcaForm.rootCauseCategory,
        fixApplied: rcaForm.fixApplied,
        preventionSteps: rcaForm.preventionSteps,
      });
      setSuccess("RCA submitted successfully");
      await refreshDashboard();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">IncidentOps</div>
        <nav className="nav">
          <button
            className={activeSection === "dashboard" ? "navItem active" : "navItem"}
            onClick={() => setActiveSection("dashboard")}
          >
            Dashboard
          </button>
          <button
            className={activeSection === "incidents" ? "navItem active" : "navItem"}
            onClick={() => setActiveSection("incidents")}
          >
            Incidents
          </button>
          <button
            className={activeSection === "analytics" ? "navItem active" : "navItem"}
            onClick={() => setActiveSection("analytics")}
          >
            Analytics
          </button>
          <button
            className={activeSection === "reports" ? "navItem active" : "navItem"}
            onClick={() => setActiveSection("reports")}
          >
            Reports
          </button>
          <button
            className={activeSection === "rca-library" ? "navItem active" : "navItem"}
            onClick={() => setActiveSection("rca-library")}
          >
            RCA Library
          </button>
          <button
            className={activeSection === "settings" ? "navItem active" : "navItem"}
            onClick={() => setActiveSection("settings")}
          >
            Settings
          </button>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <h1>Incident Management Dashboard</h1>
          <div className="headerActions">
            <span className="liveChip">Live updates</span>
            <button onClick={refreshDashboard} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </header>

        {error ? <p className="error">{error}</p> : null}
        {success ? <p className="success">{success}</p> : null}

        {activeSection === "dashboard" ? (
          <>
            <section className="kpiGrid">
          <article className="kpiCard">
            <span>Active Incidents</span>
            <strong>{activeTotal}</strong>
          </article>
          <article className="kpiCard">
            <span>P1 Incidents</span>
            <strong>{incidents.filter((item) => item.severity === "P1").length}</strong>
          </article>
          <article className="kpiCard">
            <span>Avg MTTR</span>
            <strong>{avgMttr === null ? "--" : `${avgMttr}m`}</strong>
          </article>
          <article className="kpiCard">
            <span>Signals / min</span>
            <strong>{signalsPerMinute}</strong>
          </article>
          <article className="kpiCard">
            <span>Signal Queue View</span>
            <strong>{queueDepth}</strong>
          </article>
          <article className="kpiCard">
            <span>System Health</span>
            <strong className={healthState === "ok" ? "textGood" : "textWarn"}>
              {healthState === "ok" ? "Healthy" : "Degraded"}
            </strong>
          </article>
            </section>

            <section className="dashboardGrid">
          <aside className="panel feedPanel">
            <div className="panelHead">
              <h2>Incident Feed</h2>
              <span className="tiny">Live</span>
            </div>
            <div className="filters">
              <input
                placeholder="Search incidents"
                value={componentFilter}
                onChange={(e) => {
                  setComponentFilter(e.target.value);
                  setActivePage(1);
                }}
              />
              <div className="inlineFilters">
                <select
                  value={severityFilter}
                  onChange={(e) => {
                    setSeverityFilter(e.target.value);
                    setActivePage(1);
                  }}
                >
                  <option value="">All severities</option>
                  <option value="P0">P0</option>
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                  <option value="P3">P3</option>
                </select>
                <select
                  value={stateFilter}
                  onChange={(e) => {
                    setStateFilter(e.target.value);
                    setActivePage(1);
                  }}
                >
                  <option value="">All states</option>
                  <option value="OPEN">OPEN</option>
                  <option value="INVESTIGATING">INVESTIGATING</option>
                  <option value="RESOLVED">RESOLVED</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
              </div>
            </div>
            <ul className="incidentList">
              {incidents.map((incident) => (
                <li key={incident.id}>
                  <button
                    className={incident.id === selectedId ? "item selected" : "item"}
                    onClick={() => setSelectedId(incident.id)}
                  >
                    <div className="itemRow">
                      <span className={`sev ${incident.severity.toLowerCase()}`}>
                        {incident.severity}
                      </span>
                      <small>{incident.state}</small>
                    </div>
                    <strong>{incident.componentId}</strong>
                    <small>{incident.componentType}</small>
                    <small className="signalCountLine">
                      {incident.signalCount.toLocaleString()} total signal
                      {incident.signalCount === 1 ? "" : "s"} (lifetime on this incident)
                    </small>
                  </button>
                </li>
              ))}
            </ul>
            {!loading && incidents.length === 0 ? (
              <p className="empty">No incidents found for selected filters.</p>
            ) : null}
            <div className="pager">
              <button
                disabled={activePage <= 1}
                onClick={() => setActivePage((prev) => Math.max(1, prev - 1))}
              >
                Prev
              </button>
              <span>
                Page {activePage} / {Math.max(1, Math.ceil(activeTotal / activePageSize))}
              </span>
              <button
                disabled={activePage >= Math.ceil(activeTotal / activePageSize)}
                onClick={() => setActivePage((prev) => prev + 1)}
              >
                Next
              </button>
            </div>
          </aside>

          <section className="panel detailPanel">
            <div className="panelHead">
              <h2>{selected ? `Incident: ${selected.componentId}` : "Incident Detail"}</h2>
              {selected ? (
                <span className={`stateBadge ${selected.state.toLowerCase()}`}>{selected.state}</span>
              ) : null}
            </div>
            <div className="tabRow">
              <button
                className={detailTab === "overview" ? "tab active" : "tab"}
                onClick={() => setDetailTab("overview")}
              >
                Overview
              </button>
              <button
                className={detailTab === "timeline" ? "tab active" : "tab"}
                onClick={() => setDetailTab("timeline")}
              >
                Timeline
              </button>
              <button
                className={detailTab === "signals" ? "tab active" : "tab"}
                onClick={() => setDetailTab("signals")}
              >
                Signals ({signalTotal})
              </button>
              <button
                className={detailTab === "metrics" ? "tab active" : "tab"}
                onClick={() => setDetailTab("metrics")}
              >
                Metrics
              </button>
              <button
                className={detailTab === "related" ? "tab active" : "tab"}
                onClick={() => setDetailTab("related")}
              >
                Related
              </button>
            </div>
            {selected ? (
              <>
                {detailTab === "overview" ? (
                  <div className="metaGrid">
                    <article>
                      <span>Component Type</span>
                      <strong>{selected.componentType}</strong>
                    </article>
                    <article>
                      <span>Signals</span>
                      <strong>{selected.signalCount}</strong>
                    </article>
                    <article>
                      <span>First Signal</span>
                      <strong>{formatDisplayDate(selected.firstSignalAt)}</strong>
                    </article>
                    <article>
                      <span>Resolved At</span>
                      <strong>{formatDisplayDate(selected.endedAt)}</strong>
                    </article>
                    <article>
                      <span>MTTR</span>
                      <strong>{selected.mttrMinutes ?? "--"}m</strong>
                    </article>
                  </div>
                ) : null}

                <label className="field">
                  State
                  <select
                    value={selectedState}
                    onChange={(e) => handleStateChange(e.target.value as WorkItemState)}
                  >
                    {allowedNextStates(selected.state).map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </label>

                {detailTab === "timeline" ? (
                  <>
                    <h3>Incident Timeline</h3>
                    <ul className="timeline">
                      {timelineEvents.map((event) => (
                        <li key={`${event.time}-${event.title}`}>
                          <span>{event.time}</span>
                          <strong>{event.title}</strong>
                          <small>{event.detail}</small>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {detailTab === "signals" ? (
                  <>
                    <h3>Raw Signals</h3>
                    <div className="signals">
                      {rawSignals.map((signal) => (
                        <article key={signal._id} className="signalCard">
                          <p>{signal.message}</p>
                          <small>{new Date(signal.timestamp).toLocaleString()}</small>
                        </article>
                      ))}
                    </div>
                    {rawSignals.length === 0 ? (
                      <p className="empty">No raw signals for this incident page.</p>
                    ) : null}
                    <div className="pager">
                      <button
                        disabled={signalPage <= 1}
                        onClick={() => setSignalPage((prev) => Math.max(1, prev - 1))}
                      >
                        Prev
                      </button>
                      <span>
                        Signals page {signalPage} /{" "}
                        {Math.max(1, Math.ceil(signalTotal / signalPageSize))}
                      </span>
                      <button
                        disabled={signalPage >= Math.ceil(signalTotal / signalPageSize)}
                        onClick={() => setSignalPage((prev) => prev + 1)}
                      >
                        Next
                      </button>
                    </div>
                  </>
                ) : null}

                {detailTab === "metrics" ? (
                  <div className="metaGrid">
                    <article>
                      <span>Signals / min (latest)</span>
                      <strong>{signalsPerMinute}</strong>
                    </article>
                    <article>
                      <span>Queue Depth</span>
                      <strong>{queueDepth}</strong>
                    </article>
                    <article>
                      <span>DLQ Depth</span>
                      <strong>{dlqDepth}</strong>
                    </article>
                  </div>
                ) : null}

                {detailTab === "related" ? (
                  <>
                    {relatedIncidents.length > 0 ? (
                      <ul className="incidentList">
                        {relatedIncidents.map((incident) => (
                          <li key={`related-${incident.id}`}>
                            <button className="item" onClick={() => setSelectedId(incident.id)}>
                              <div className="itemRow">
                                <span className={`sev ${incident.severity.toLowerCase()}`}>
                                  {incident.severity}
                                </span>
                                <small>{incident.state}</small>
                              </div>
                              <strong>{incident.componentId}</strong>
                              <small>{incident.componentType}</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="empty">
                        No related incidents in current feed for this component type/severity.
                      </p>
                    )}
                  </>
                ) : null}
              </>
            ) : (
              <p>Select an incident to inspect details.</p>
            )}
          </section>

          <section className="panel rcaPanel">
            <div className="panelHead">
              <h2>RCA Information</h2>
              <span className="tiny">{selected?.rca ? "Complete" : "Pending"}</span>
            </div>
            <div className="form">
              <label className="field">
                Incident Start
                <input
                  type="datetime-local"
                  value={rcaForm.incidentStart}
                  onChange={(e) =>
                    setRcaForm((prev) => ({ ...prev, incidentStart: e.target.value }))
                  }
                />
              </label>
              <label className="field">
                Incident End
                <input
                  type="datetime-local"
                  value={rcaForm.incidentEnd}
                  onChange={(e) =>
                    setRcaForm((prev) => ({ ...prev, incidentEnd: e.target.value }))
                  }
                />
              </label>
              <label className="field">
                Root Cause Category
                <select
                  value={rcaForm.rootCauseCategory}
                  onChange={(e) =>
                    setRcaForm((prev) => ({ ...prev, rootCauseCategory: e.target.value }))
                  }
                >
                  <option value="">Select category</option>
                  {rootCauseOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Root Cause
                <textarea
                  value={rcaForm.fixApplied}
                  onChange={(e) =>
                    setRcaForm((prev) => ({ ...prev, fixApplied: e.target.value }))
                  }
                />
              </label>
              <label className="field">
                Prevention Steps
                <textarea
                  value={rcaForm.preventionSteps}
                  onChange={(e) =>
                    setRcaForm((prev) => ({ ...prev, preventionSteps: e.target.value }))
                  }
                />
              </label>
              <button onClick={submitRca}>
                Submit RCA
              </button>
            </div>

            <h3>Signals / Minute (Last Hour)</h3>
            <div className="timeseries">
              {timeseries.map((point) => (
                <div key={point.minute} className="barRow">
                  <span>{new Date(point.minute).toLocaleTimeString()}</span>
                  <div className="barTrack">
                    <div
                      className={`bar${point.count > 0 ? " barPositive" : ""}`}
                      style={{ width: timeseriesBarWidthPercent(point.count, timeseriesMaxCount) }}
                    />
                  </div>
                  <span>{point.count}</span>
                </div>
              ))}
            </div>
            {timeseries.length === 0 ? <p className="empty">No timeseries data.</p> : null}
          </section>
            </section>

            <section className="bottomGrid">
          <article className="panel">
            <div className="panelHead">
              <h2>Signals Over Time</h2>
              <span className="tiny">Last 60 minutes</span>
            </div>
            <div className="timeseries">
              {recentTimeseriesPoints.map((point) => (
                <div key={`trend-${point.minute}`} className="barRow">
                  <span>{new Date(point.minute).toLocaleTimeString()}</span>
                  <div className="barTrack">
                    <div
                      className={`bar${point.count > 0 ? " barPositive" : ""}`}
                      style={{
                        width: timeseriesBarWidthPercent(point.count, recentTimeseriesMaxCount),
                      }}
                    />
                  </div>
                  <span>{point.count}</span>
                </div>
              ))}
            </div>
          </article>
          <article className="panel">
            <div className="panelHead">
              <h2>Severity Mix</h2>
              <span className="tiny">{incidents.length} active</span>
            </div>
            <div className="metaGrid">
              <article>
                <span>P0</span>
                <strong>{incidents.filter((item) => item.severity === "P0").length}</strong>
              </article>
              <article>
                <span>P1</span>
                <strong>{incidents.filter((item) => item.severity === "P1").length}</strong>
              </article>
              <article>
                <span>P2</span>
                <strong>{incidents.filter((item) => item.severity === "P2").length}</strong>
              </article>
              <article>
                <span>P3</span>
                <strong>{incidents.filter((item) => item.severity === "P3").length}</strong>
              </article>
            </div>
          </article>
          <article className="panel">
            <div className="panelHead">
              <h2>Queue Overview</h2>
              <span className="tiny">Main + DLQ</span>
            </div>
            <div className="metaGrid">
              <article>
                <span>Main Queue</span>
                <strong>{queueDepth}</strong>
              </article>
              <article>
                <span>Dead Letter Queue</span>
                <strong>{dlqDepth}</strong>
              </article>
              <article>
                <span>API Service</span>
                <strong className={healthState === "ok" ? "textGood" : "textWarn"}>
                  {healthState === "ok" ? "Healthy" : "Degraded"}
                </strong>
              </article>
            </div>
          </article>
            </section>
          </>
        ) : null}

        {activeSection === "incidents" ? (
          <section className="panel">
            <div className="panelHead">
              <h2>Incidents</h2>
              <span className="tiny">{incidents.length} loaded</span>
            </div>
            <ul className="incidentList">
              {incidents.map((incident) => (
                <li key={`inc-page-${incident.id}`}>
                  <button className="item" onClick={() => setSelectedId(incident.id)}>
                    <div className="itemRow">
                      <span className={`sev ${incident.severity.toLowerCase()}`}>
                        {incident.severity}
                      </span>
                      <small>{incident.state}</small>
                    </div>
                    <strong>{incident.title}</strong>
                    <small>{incident.componentId}</small>
                    <small className="signalCountLine">
                      {incident.signalCount.toLocaleString()} total (lifetime)
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {activeSection === "analytics" ? (
          <section className="panel">
            <div className="panelHead">
              <h2>Analytics</h2>
              <span className="tiny">Live metrics</span>
            </div>
            <div className="metaGrid">
              <article>
                <span>Active Incidents</span>
                <strong>{activeTotal}</strong>
              </article>
              <article>
                <span>Average MTTR</span>
                <strong>{avgMttr ?? "--"}m</strong>
              </article>
              <article>
                <span>Signals per minute</span>
                <strong>{signalsPerMinute}</strong>
              </article>
              <article>
                <span>Queue depth</span>
                <strong>{queueDepth}</strong>
              </article>
            </div>
            <div className="timeseries">
              {timeseries.map((point) => (
                <div key={`analytics-${point.minute}`} className="barRow">
                  <span>{new Date(point.minute).toLocaleTimeString()}</span>
                  <div className="barTrack">
                    <div
                      className={`bar${point.count > 0 ? " barPositive" : ""}`}
                      style={{ width: timeseriesBarWidthPercent(point.count, timeseriesMaxCount) }}
                    />
                  </div>
                  <span>{point.count}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {activeSection === "reports" ? (
          <section className="panel">
            <div className="panelHead">
              <h2>Reports</h2>
              <span className="tiny">Submission support</span>
            </div>
            <p className="empty">
              Use the Dashboard and Analytics views to capture screenshots for submission.
              Export endpoint is not implemented in backend yet.
            </p>
          </section>
        ) : null}

        {activeSection === "rca-library" ? (
          <section className="panel rcaLibraryPanel">
            <div className="panelHead">
              <h2>RCA Library</h2>
              <span className="tiny">{rcaHistoryItems.length} records</span>
            </div>
            <div className="filters">
              <input
                placeholder="Search component/category"
                value={rcaSearch}
                onChange={(e) => setRcaSearch(e.target.value)}
              />
              <div className="inlineFilters">
                <select
                  value={rcaSeverityFilter}
                  onChange={(e) => setRcaSeverityFilter(e.target.value)}
                >
                  <option value="">All severities</option>
                  <option value="P0">P0</option>
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                  <option value="P3">P3</option>
                </select>
                <select
                  value={rcaCategoryFilter}
                  onChange={(e) => setRcaCategoryFilter(e.target.value)}
                >
                  <option value="">All root causes</option>
                  {rcaCategoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="rcaLibraryLayout">
              <div className="rcaLibraryListColumn">
                {rcaHistoryItems.length === 0 ? (
                  <p className="empty">No RCA records available</p>
                ) : (
                  <ul className="incidentList rcaLibraryList">
                    {rcaHistoryItems.map((incident) => (
                      <li key={`rca-${incident.id}`}>
                        <button
                          type="button"
                          className={`item${rcaLibrarySelectedId === incident.id ? " selected" : ""}`}
                          onClick={() => setRcaLibrarySelectedId(incident.id)}
                        >
                          <div className="itemRow">
                            <span className={`sev ${incident.severity.toLowerCase()}`}>
                              {incident.severity}
                            </span>
                            <small>
                              {formatDisplayDate(
                                incident.endedAt ??
                                  incident.rca?.incidentEnd ??
                                  incident.rca?.submittedAt ??
                                  null
                              )}
                            </small>
                          </div>
                          <strong>{incident.componentId}</strong>
                          <small>{incident.rca?.rootCauseCategory}</small>
                          <small>{shortText(incident.rca?.fixApplied || "", 80)}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rcaLibraryDetailColumn">
                {!rcaLibrarySelectedIncident ? (
                  <p className="empty rcaLibraryDetailHint">
                    Select a record to read the full root cause analysis.
                  </p>
                ) : (
                  <article className="rcaDetailReadonly">
                    <header className="rcaDetailReadonlyHead">
                      <h3>{rcaLibrarySelectedIncident.componentId}</h3>
                      <span className="tiny">{rcaLibrarySelectedIncident.state}</span>
                    </header>
                    <div className="itemRow">
                      <span
                        className={`sev ${rcaLibrarySelectedIncident.severity.toLowerCase()}`}
                      >
                        {rcaLibrarySelectedIncident.severity}
                      </span>
                      {typeof rcaLibrarySelectedIncident.mttrMinutes === "number" ? (
                        <small className="tiny">
                          MTTR {rcaLibrarySelectedIncident.mttrMinutes} min
                        </small>
                      ) : null}
                    </div>
                    <dl className="rcaDetailDl">
                      <dt>Root cause category</dt>
                      <dd>{rcaLibrarySelectedIncident.rca?.rootCauseCategory}</dd>
                      <dt>Incident window</dt>
                      <dd>
                        {formatDisplayDate(rcaLibrarySelectedIncident.rca?.incidentStart)} →{" "}
                        {formatDisplayDate(rcaLibrarySelectedIncident.rca?.incidentEnd)}
                      </dd>
                      {rcaLibrarySelectedIncident.rca?.submittedAt ? (
                        <>
                          <dt>RCA submitted</dt>
                          <dd>{formatDisplayDate(rcaLibrarySelectedIncident.rca.submittedAt)}</dd>
                        </>
                      ) : null}
                      <dt>Fix applied</dt>
                      <dd className="rcaDetailBody">{rcaLibrarySelectedIncident.rca?.fixApplied}</dd>
                      <dt>Prevention</dt>
                      <dd className="rcaDetailBody">
                        {rcaLibrarySelectedIncident.rca?.preventionSteps}
                      </dd>
                    </dl>
                  </article>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {activeSection === "settings" ? (
          <section className="panel">
            <div className="panelHead">
              <h2>Settings</h2>
              <span className="tiny">Runtime</span>
            </div>
            <div className="metaGrid">
              <article>
                <span>API Base URL</span>
                <strong>{import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3000"}</strong>
              </article>
              <article>
                <span>Viewer key configured</span>
                <strong>{viewerKey ? "Yes" : "No"}</strong>
              </article>
              <article>
                <span>Operator key configured</span>
                <strong>{operatorKey ? "Yes" : "No"}</strong>
              </article>
              <article>
                <span>Admin key configured</span>
                <strong>{adminKey ? "Yes" : "No"}</strong>
              </article>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

function dedupeByComponent(items: Incident[]): Incident[] {
  const map = new Map<string, Incident>();
  for (const item of items) {
    if (!map.has(item.componentId)) {
      map.set(item.componentId, item);
    }
  }
  return Array.from(map.values());
}

function severityScore(severity: Severity): number {
  const rank: Record<Severity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return rank[severity];
}

function allowedNextStates(current: WorkItemState): WorkItemState[] {
  if (current === "OPEN") return ["OPEN", "INVESTIGATING"];
  if (current === "INVESTIGATING") return ["INVESTIGATING", "RESOLVED"];
  if (current === "RESOLVED") return ["RESOLVED", "CLOSED"];
  return ["CLOSED"];
}

function formatDisplayDate(iso?: string | null): string {
  if (!iso) return "Not available yet";
  return new Date(iso).toLocaleString();
}

function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

function toInputDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function shortText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trimEnd()}...`;
}

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return String(error.response?.data?.error || error.message);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

export default App;
