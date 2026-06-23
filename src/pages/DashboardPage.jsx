import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Plot from "react-plotly.js";
import { useAuth } from "../auth/useAuth";
import "./DashboardPage.css";

function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return {};
  }
}

function initialsFromName(name = "", email = "") {
  const source = name || email.split("@")[0] || "U";
  const parts = source.replace(/[._-]/g, " ").trim().split(/\s+/);
  return (parts[0]?.[0] || "U").concat(parts[1]?.[0] || "").toUpperCase();
}

const WS_URL = import.meta.env.VITE_WS_URL;
const MAX_RECONNECT_ATTEMPTS = 5;

const DASHBOARD_SUGGESTIONS = [
  "Who leads in battery technology?",
  "Tell me about the Otsuka portfolio as a group",
  "Compare Samsung SDI and LG Energy Solution",
  "What technologies are emerging in healthcare?",
];

// Bubble marker sizes: area-proportional (sqrt) scaling into a pixel range.
function scaleBubbleSizes(values, minPx = 14, maxPx = 48) {
  const nums = values.map((v) => (typeof v === "number" ? v : 0));
  const max = Math.max(...nums, 1);
  return nums.map((v) => {
    const frac = Math.sqrt(Math.max(v, 0)) / Math.sqrt(max);
    return minPx + frac * (maxPx - minPx);
  });
}

// Rebuild a Plotly spec for an interactive chart given the chosen axis keys.
// Starts from the backend's initial_spec (keeps title/layout/colors) and only
// swaps the data arrays that the dropdowns control.
function buildSpec(tile, xKey, yKey) {
  const base = tile.initial_spec;
  const layout = JSON.parse(JSON.stringify(base.layout || {}));
  const rows = tile.rows || [];

  // Update axis titles to match the active option labels.
  const xLabel = labelForKey(tile.axes?.x, xKey);
  const yLabel = labelForKey(tile.axes?.y, yKey);

  switch (tile.chartType) {
    case "bar": {
      const horizontal = tile.orientation === "h";
      // Sort so the largest value reads naturally (top for h, doesn't matter for v
      // but harmless). For horizontal, ascending puts the biggest bar at the top.
      const valueKey = horizontal ? xKey : yKey;
      const sorted = [...rows].sort((a, b) =>
        horizontal ? a[valueKey] - b[valueKey] : b[valueKey] - a[valueKey]
      );
      const labels = sorted.map((r) => r[tile.labelKey]);
      const values = sorted.map((r) => r[valueKey]);
      const trace = {
        ...base.data[0],
        type: "bar",
        orientation: horizontal ? "h" : undefined,
        x: horizontal ? values : labels,
        y: horizontal ? labels : values,
      };
      if (layout.xaxis) layout.xaxis.title = { text: horizontal ? xLabel : yLabel };
      if (layout.yaxis) layout.yaxis.title = { text: horizontal ? yLabel : xLabel };
      return { data: [trace], layout };
    }

    case "line": {
      const trace = {
        ...base.data[0],
        type: "scatter",
        mode: "lines+markers",
        x: rows.map((r) => r[xKey]),
        y: rows.map((r) => r[yKey]),
      };
      if (layout.xaxis) layout.xaxis.title = { text: xLabel };
      if (layout.yaxis) layout.yaxis.title = { text: yLabel };
      return { data: [trace], layout };
    }

    case "scatter": {
      const sizeVals = rows.map((r) => r[tile.sizeKey]);
      const trace = {
        ...base.data[0],
        type: "scatter",
        mode: "markers+text",
        x: rows.map((r) => r[xKey]),
        y: rows.map((r) => r[yKey]),
        text: rows.map((r) => r[tile.labelKey]),
        textposition: "top center",
        marker: { ...(base.data[0].marker || {}), size: scaleBubbleSizes(sizeVals) },
      };
      if (layout.xaxis) layout.xaxis.title = { text: xLabel };
      if (layout.yaxis) layout.yaxis.title = { text: yLabel };
      return { data: [trace], layout };
    }

    case "treemap": {
      const labels = rows.map((r) => r[tile.labelKey]);
      const values = rows.map((r) => r[xKey]); // treemap measure lives on x
      const trace = {
        ...base.data[0],
        type: "treemap",
        labels,
        parents: labels.map(() => ""),
        values,
        branchvalues: "total",
      };
      return { data: [trace], layout };
    }

    default:
      return base;
  }
}

function labelForKey(axis, key) {
  if (!axis) return "";
  if (axis.fixed) return axis.fixed.label;
  const opt = axis.options?.find((o) => o.key === key);
  return opt?.label || "";
}

// A single switchable axis dropdown.
function AxisControl({ axis, value, onChange, label }) {
  if (!axis?.switchable) return null;
  return (
    <label className="axis-control">
      <span className="axis-control-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {axis.options.map((o) => (
          <option key={o.id} value={o.key}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

// Seed the active key for an axis, covering every shape the backend emits:
// fixed axis, switchable axis (use its `default` option's key), the treemap's
// `measureKey`, or the chart's `initial.xKey`/`yKey`.
function initialKey(tile, dim) {
  const axis = tile.axes?.[dim];
  // 1. explicit per-chart initial (xKey / yKey)
  const fromInitial = tile.initial?.[`${dim}Key`];
  if (fromInitial) return fromInitial;
  // 2. treemap measure lives on x as `measureKey`
  if (dim === "x" && tile.initial?.measureKey) return tile.initial.measureKey;
  // 3. fixed axis
  if (axis?.fixed?.key) return axis.fixed.key;
  // 4. switchable axis → its default option's key
  if (axis?.switchable && axis.options) {
    const def = axis.options.find((o) => o.id === axis.default);
    if (def) return def.key;
    return axis.options[0]?.key ?? "";
  }
  return "";
}

function InteractiveChart({ tile }) {
  const [xKey, setXKey] = useState(() => initialKey(tile, "x"));
  const [yKey, setYKey] = useState(() => initialKey(tile, "y"));
  
  const spec = useMemo(() => buildSpec(tile, xKey, yKey), [tile, xKey, yKey]);

  const xSwitch = tile.axes?.x?.switchable;
  const ySwitch = tile.axes?.y?.switchable;
  // treemap's switchable axis is the "measure" on x; label it accordingly.
  const xLabel = tile.chartType === "treemap" ? "Measure by" : "X axis";

  return (
    <div className="tile tile-chart">
      <div className="tile-head">
        <h3 className="tile-title">{tile.title}</h3>
        {(xSwitch || ySwitch) && (
          <div className="tile-controls">
            <AxisControl axis={tile.axes.x} value={xKey} onChange={setXKey} label={xLabel} />
            <AxisControl axis={tile.axes.y} value={yKey} onChange={setYKey} label="Y axis" />
          </div>
        )}
      </div>
      <div className="chart-block">
        <Plot
          data={spec.data}
          layout={{ ...spec.layout, autosize: true }}
          useResizeHandler
          style={{ width: "100%", height: "380px" }}
          config={{ displayModeBar: "hover", responsive: true, displaylogo: false }}
        />
      </div>
    </div>
  );
}

function KpiCard({ tile }) {
  const value = typeof tile.value === "number"
    ? tile.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : tile.value;
  return (
    <div className="tile tile-kpi">
      <div className="kpi-title">{tile.title}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

function TableTile({ tile }) {
  return (
    <div className="tile tile-table">
      <h3 className="tile-title">{tile.title}</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>{tile.columns.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {tile.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>
                    {typeof cell === "number"
                      ? cell.toLocaleString(undefined, { maximumFractionDigits: 2 })
                      : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { idToken, logout } = useAuth();

  const claims = useMemo(() => parseJwt(idToken || ""), [idToken]);
  const userEmail = claims.email || "you@otsuka.jp";
  const userName = claims.name || claims["cognito:username"] || userEmail.split("@")[0];
  const userInitials = initialsFromName(userName, userEmail);

  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [preamble, setPreamble] = useState("");
  const [dashboard, setDashboard] = useState(null); // { title, template_id, tiles }
  const [menuOpen, setMenuOpen] = useState(false);

  const socketRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  // Separate socket, dedicated to the dashboard route.
  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;

    function connect() {
      const socket = new WebSocket(`${WS_URL}?token=${idToken}`);
      socketRef.current = socket;

      socket.onopen = () => {
        reconnectAttemptsRef.current = 0;
        if (cancelled) socket.close();
      };

      socket.onmessage = (e) => handleSocketMessage(e.data);

      socket.onclose = () => {
        if (cancelled) return;
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 10000);
          reconnectAttemptsRef.current += 1;
          reconnectTimerRef.current = setTimeout(connect, delay);
        }
      };

      socket.onerror = (err) => console.error("Dashboard WS error:", err);
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimerRef.current);
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) socket.close();
    };
  }, [idToken]);

  function handleSocketMessage(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    switch (data.type) {
      case "start":
        // Full replace: wipe the previous dashboard the moment a new run begins.
        setPreamble("");
        setDashboard(null);
        break;
      case "token":
        setPreamble((p) => p + data.text);
        break;
      case "plan":
        // template_id known; nothing to render yet, dashboard event carries it too.
        break;
      case "dashboard":
        setDashboard({ title: data.title, template_id: data.template_id, tiles: data.tiles });
        break;
      case "done":
        setRunning(false);
        break;
      case "error":
        setPreamble((p) => p + `\n\n⚠️ ${data.message || "Something went wrong."}`);
        setRunning(false);
        break;
      default:
        break;
    }
  }

  function runQuery(text) {
    const trimmed = text.trim();
    if (!trimmed || running) return;
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      console.error("Socket not connected yet — try again in a moment");
      return;
    }
    setInput("");
    setRunning(true);
    setPreamble("");
    setDashboard(null);
    socketRef.current.send(JSON.stringify({ action: "createdashboard", prompt: trimmed }));
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      runQuery(input);
    }
  }

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const kpis = dashboard?.tiles.filter((t) => t.kind === "kpi") || [];
  const rest = dashboard?.tiles.filter((t) => t.kind !== "kpi") || [];
  const showEmpty = !dashboard && !running && !preamble;

  return (
    <div className="dash-app">

      <header className="top-nav">
        <div className="brand">
          <div className="brand-mark">P</div>
          <span className="brand-text">IP Atlas</span>
        </div>

        <nav className="top-links">
          <button className="top-link active">Dashboard</button>
          <button className="top-link" onClick={() => navigate("/chat")}>AI Chat</button>
        </nav>

        <div className="user-menu-dashboard" onClick={(e) => e.stopPropagation()}>
          <button className="user-trigger-dashboard" onClick={() => setMenuOpen((o) => !o)}>
            <span className="user-avatar">{userInitials}</span>
            <span className="user-name-dashboard">{userName}</span>
          </button>
          {menuOpen && (
            <div className="user-dropdown-dashboard">
              <div className="dropdown-label">Signed in as</div>
              <div className="dropdown-email">{userEmail}</div>
              <button className="dropdown-logout" onClick={handleLogout}>Log out</button>
            </div>
          )}
        </div>
      </header>

      <div className="dash-body">
        <div className="dash-composer-wrap">
          <div className="dash-composer">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask for a dashboard — a landscape, a company, a comparison..."
            />
            <button
              className="dash-run-btn"
              onClick={() => runQuery(input)}
              disabled={!input.trim() || running}
            >
              {running ? "Building..." : "Generate"}
            </button>
          </div>
        </div>

        <div className="dash-scroll">
          {showEmpty ? (
            <div className="dash-empty">
              <div className="dash-empty-mark">P</div>
              <h1>Build a patent landscape dashboard</h1>
              <p>Describe what you want to see — Atlas picks the right layout.</p>
              <div className="dash-suggestions">
                {DASHBOARD_SUGGESTIONS.map((s) => (
                  <button key={s} className="dash-suggestion" onClick={() => runQuery(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="dash-content">
              {preamble && (
                <div className="dash-preamble">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{preamble}</ReactMarkdown>
                </div>
              )}

              {running && !dashboard && (
                <div className="dash-building">
                  <span></span><span></span><span></span>
                </div>
              )}

              {dashboard && (
                <>
                  <h2 className="dash-title">{dashboard.title}</h2>

                  {kpis.length > 0 && (
                    <div className="kpi-row">
                      {kpis.map((t, i) => <KpiCard key={i} tile={t} />)}
                    </div>
                  )}

                  <div className="tile-grid">
                    {rest.map((t, i) => {
                      if (t.kind === "interactive_chart") return <InteractiveChart key={i} tile={t} />;
                      if (t.kind === "table") return <TableTile key={i} tile={t} />;
                      return null;
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}