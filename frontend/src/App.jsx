import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = "http://127.0.0.1:8000";

// English comment: California Housing target "MedHouseVal" is commonly in units of $100,000.
// So 2.56 => approx $256,000 (also the dataset is capped around 5.0).
const TARGET_UNIT_MULTIPLIER_USD = 100000;

const FIELD_META = {
  MedInc: { step: "0.01", min: 0, help: "Median income (dataset feature)" },
  HouseAge: { step: "1", min: 0, max: 120, help: "Median house age" },
  AveRooms: { step: "0.01", min: 0, help: "Avg rooms per household" },
  AveBedrms: { step: "0.01", min: 0, help: "Avg bedrooms per household" },
  Population: { step: "1", min: 0, help: "Block population" },
  AveOccup: { step: "0.01", min: 0, help: "Avg occupants per household" },
  Latitude: { step: "0.0001", min: 32, max: 42, help: "CA lat ~32–42" },
  Longitude: { step: "0.0001", min: -125, max: -114, help: "CA long ~-125 to -114" },
};

function clamp(n, a, b) {
  return Math.min(Math.max(n, a), b);
}

function formatNum(n, digits = 4) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "";
  return x.toFixed(digits);
}

function formatUSD(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "";
  return x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function useCountUp(value, durationMs = 650) {
  const [display, setDisplay] = useState(value ?? 0);
  const rafRef = useRef(null);
  const prevRef = useRef(value ?? 0);

  useEffect(() => {
    const to = Number(value);
    if (!Number.isFinite(to)) return;

    const from = Number(prevRef.current);
    prevRef.current = to;

    const start = performance.now();

    const tick = (t) => {
      const p = clamp((t - start) / durationMs, 0, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - p, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, durationMs]);

  return display;
}

function setCardTiltVars(el, e) {
  const r = el.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width;  // 0..1
  const py = (e.clientY - r.top) / r.height;  // 0..1
  el.style.setProperty("--px", px.toFixed(4));
  el.style.setProperty("--py", py.toFixed(4));
}

export default function App() {
  const sampleDefaults = useMemo(
    () => ({
      MedInc: 5.0,
      HouseAge: 20.0,
      AveRooms: 5.0,
      AveBedrms: 1.0,
      Population: 1000.0,
      AveOccup: 3.0,
      Latitude: 34.05,
      Longitude: -118.25,
    }),
    []
  );

  const presets = useMemo(
    () => [
      {
        name: "LA-ish",
        values: {
          MedInc: 5.0,
          HouseAge: 25,
          AveRooms: 5.2,
          AveBedrms: 1.05,
          Population: 1100,
          AveOccup: 3.1,
          Latitude: 34.05,
          Longitude: -118.25,
        },
      },
      {
        name: "SF-ish",
        values: {
          MedInc: 7.5,
          HouseAge: 35,
          AveRooms: 4.8,
          AveBedrms: 1.02,
          Population: 900,
          AveOccup: 2.6,
          Latitude: 37.77,
          Longitude: -122.42,
        },
      },
      {
        name: "SD-ish",
        values: {
          MedInc: 6.2,
          HouseAge: 22,
          AveRooms: 5.6,
          AveBedrms: 1.08,
          Population: 1200,
          AveOccup: 3.0,
          Latitude: 32.72,
          Longitude: -117.16,
        },
      },
    ],
    []
  );

  const [schemaLoading, setSchemaLoading] = useState(true);
  const [schemaError, setSchemaError] = useState("");
  const [serverOk, setServerOk] = useState(null);

  const [fields, setFields] = useState([]);
  const [form, setForm] = useState({});
  const [filter, setFilter] = useState("");

  const [predictLoading, setPredictLoading] = useState(false);
  const [prediction, setPrediction] = useState(null);
  const [error, setError] = useState("");

  const [metrics, setMetrics] = useState(null);
  const [metricsError, setMetricsError] = useState("");

  const [toast, setToast] = useState(null);

  // Spotlight follow
  function onMouseMove(e) {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }

  function showToast(message, type = "ok") {
    setToast({ message, type, id: Date.now() });
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 1800);
  }

  async function boot() {
    setSchemaLoading(true);
    setSchemaError("");
    setMetricsError("");
    setError("");

    // Health
    try {
      const h = await fetch(`${API_BASE}/health`);
      setServerOk(h.ok);
    } catch {
      setServerOk(false);
    }

    // Schema
    try {
      const res = await fetch(`${API_BASE}/schema`);
      if (!res.ok) throw new Error("Schema request failed. Is FastAPI running?");
      const data = await res.json();
      const expected = Array.isArray(data.expected_features) ? data.expected_features : [];
      if (expected.length === 0) throw new Error("Invalid schema payload from backend.");
      setFields(expected);

      // Init form
      const initial = {};
      for (const k of expected) {
        initial[k] = Object.prototype.hasOwnProperty.call(sampleDefaults, k) ? sampleDefaults[k] : 0;
      }
      setForm(initial);
    } catch (e) {
      setSchemaError(e?.message || "Could not load schema.");
    }

    // Metrics (optional)
    try {
      const m = await fetch(`${API_BASE}/metrics`);
      if (!m.ok) throw new Error("No metrics yet (train the model first).");
      const data = await m.json();
      setMetrics(data);
    } catch (e) {
      setMetrics(null);
      setMetricsError(e?.message || "Could not load metrics.");
    }

    setSchemaLoading(false);
  }

  useEffect(() => {
    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredFields = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter((f) => f.toLowerCase().includes(q));
  }, [fields, filter]);

  function onChange(e) {
    const { name, value } = e.target;
    if (value === "") {
      setForm((prev) => ({ ...prev, [name]: "" }));
      return;
    }
    setForm((prev) => ({ ...prev, [name]: Number(value) }));
  }

  function resetForm() {
    const initial = {};
    for (const k of fields) {
      initial[k] = Object.prototype.hasOwnProperty.call(sampleDefaults, k) ? sampleDefaults[k] : 0;
    }
    setForm(initial);
    setPrediction(null);
    setError("");
    showToast("Reset done ✨", "ok");
  }

  function applyPreset(p) {
    const next = { ...form };
    for (const k of fields) {
      if (Object.prototype.hasOwnProperty.call(p.values, k)) next[k] = p.values[k];
    }
    setForm(next);
    setPrediction(null);
    setError("");
    showToast(`Preset applied: ${p.name}`, "ok");
  }

  function randomize() {
    // English comment: lightweight randomization within reasonable ranges
    const next = { ...form };
    for (const k of fields) {
      const base = Number(next[k]);
      if (!Number.isFinite(base)) continue;

      const meta = FIELD_META[k] || {};
      const min = meta.min ?? base - Math.abs(base) * 0.2;
      const max = meta.max ?? base + Math.abs(base) * 0.2 + 1;

      const r = min + Math.random() * (max - min);
      // Keep decimals stable
      next[k] = meta.step && meta.step !== "1" ? Number(r.toFixed(4)) : Math.round(r);
    }
    setForm(next);
    setPrediction(null);
    setError("");
    showToast("Randomized inputs 🎲", "ok");
  }

  async function onPredict() {
    setPredictLoading(true);
    setError("");
    setPrediction(null);

    // Basic validation
    const bad = [];
    for (const k of fields) {
      const v = form[k];
      if (v === "" || Number.isNaN(Number(v))) bad.push(k);
    }
    if (bad.length > 0) {
      setPredictLoading(false);
      setError(`Please provide valid numbers for: ${bad.join(", ")}`);
      showToast("Fix invalid fields ⚠️", "bad");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok) {
        const msg = data?.detail ? JSON.stringify(data.detail) : "Request failed";
        throw new Error(msg);
      }

      setPrediction(data.prediction);
      showToast("Prediction ready ✅", "ok");
    } catch (e) {
      setError(e?.message || "Unknown error");
      showToast("Prediction failed ❌", "bad");
    } finally {
      setPredictLoading(false);
    }
  }

  const predRaw = prediction === null ? null : Number(prediction);
  const predUSD = predRaw === null ? null : predRaw * TARGET_UNIT_MULTIPLIER_USD;

  const rmseUSD = metrics?.rmse ? metrics.rmse * TARGET_UNIT_MULTIPLIER_USD : null;
  const maeUSD = metrics?.mae ? metrics.mae * TARGET_UNIT_MULTIPLIER_USD : null;

  // Count-up animations
  const predRawAnimated = useCountUp(predRaw ?? 0, 700);
  const predUsdAnimated = useCountUp(predUSD ?? 0, 820);

  const meterPct = predRaw === null ? 0 : clamp((predRaw / 5) * 100, 0, 100);

  return (
    <div className="page" onMouseMove={onMouseMove}>
      <div className="aurora" aria-hidden="true" />
      <div className="noise" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`} key={toast.id}>
          <div className="toastDot" />
          <div className="toastMsg">{toast.message}</div>
        </div>
      )}

      <div className="shell">
        <header
          className="topbar card tilt"
          onMouseMove={(e) => setCardTiltVars(e.currentTarget, e)}
          onMouseLeave={(e) => {
            e.currentTarget.style.setProperty("--px", "0.5");
            e.currentTarget.style.setProperty("--py", "0.5");
          }}
        >
          <div className="brand">
            <div className="brandIcon" aria-hidden="true">
              🏠
            </div>
            <div className="brandText">
              <div className="titleRow">
                <h1 className="title">House Price Prediction</h1>
                <span className={`status ${serverOk ? "ok" : serverOk === false ? "bad" : ""}`}>
                  {serverOk === null ? "Connecting…" : serverOk ? "Backend Online" : "Backend Offline"}
                </span>
              </div>
              <p className="subtitle">
                Neon Glass UI • Animations • Metrics • USD conversion • Backend: <code>{API_BASE}</code>
              </p>
            </div>
          </div>

          <div className="topActions">
            <button className="btn ghost" onClick={() => window.open(`${API_BASE}/docs`, "_blank")}>
              Open API Docs
            </button>
            <button className="btn ghost" onClick={boot}>
              Reload Data
            </button>
          </div>
        </header>

        {schemaLoading ? (
          <div className="card hero">
            <div className="shine" />
            <div className="heroInner">
              <h2>Booting up…</h2>
              <p className="muted">Loading schema + metrics from backend.</p>
              <div className="skeletonRow">
                <div className="sk" />
                <div className="sk" />
                <div className="sk" />
              </div>
            </div>
          </div>
        ) : schemaError ? (
          <div className="card panel error">
            <h2>Schema load failed</h2>
            <p className="muted">{schemaError}</p>
            <div className="row">
              <button className="btn" onClick={boot}>
                Retry
              </button>
              <button
                className="btn ghost"
                onClick={() => alert("Check: FastAPI running, CORS allows http://localhost:5173")}
              >
                Debug tips
              </button>
            </div>
          </div>
        ) : (
          <main className="grid3">
            {/* Column 1: Inputs */}
            <section
              className="card panel tilt"
              onMouseMove={(e) => setCardTiltVars(e.currentTarget, e)}
              onMouseLeave={(e) => {
                e.currentTarget.style.setProperty("--px", "0.5");
                e.currentTarget.style.setProperty("--py", "0.5");
              }}
            >
              <div className="panelHead">
                <div>
                  <h2>Enter Features</h2>
                  <p className="muted">Auto-generated from backend schema.</p>
                </div>
                <span className="pill">{fields.length} features</span>
              </div>

              <div className="searchRow">
                <div className="searchWrap">
                  <span className="searchIcon" aria-hidden="true">⌕</span>
                  <input
                    className="search"
                    placeholder="Search feature… (e.g., Lat, MedInc)"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                  {filter && (
                    <button className="clearBtn" onClick={() => setFilter("")} title="Clear">
                      ✕
                    </button>
                  )}
                </div>

                <button className="btn tinyBtn ghost" onClick={randomize}>
                  Randomize
                </button>
              </div>

              <div className="presetRow">
                <span className="muted tiny">Quick presets:</span>
                {presets.map((p) => (
                  <button key={p.name} className="chipBtn" onClick={() => applyPreset(p)}>
                    {p.name}
                  </button>
                ))}
              </div>

              <div className="formGrid">
                {filteredFields.map((key) => {
                  const meta = FIELD_META[key] || {};
                  const invalid = form[key] === "" || Number.isNaN(Number(form[key]));
                  return (
                    <div className={`field ${invalid ? "invalid" : ""}`} key={key}>
                      <label className="label">
                        <span className="labelName">{key}</span>
                        <span className="labelHint">{meta.help ?? ""}</span>
                      </label>

                      <div className="inputWrap">
                        <input
                          name={key}
                          type="number"
                          step={meta.step ?? "any"}
                          min={meta.min}
                          max={meta.max}
                          value={form[key]}
                          onChange={onChange}
                          className="input"
                          placeholder="0"
                        />
                        <span className="miniTag">
                          {meta.step ? `step ${meta.step}` : "any"}
                        </span>
                      </div>

                      {(meta.min !== undefined || meta.max !== undefined) && (
                        <div className="range">
                          <span>min {meta.min ?? "—"}</span>
                          <span>max {meta.max ?? "—"}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="actions">
                <button className="btn primary" onClick={onPredict} disabled={predictLoading}>
                  {predictLoading ? (
                    <span className="btnInline">
                      <span className="spinner" aria-hidden="true" />
                      Predicting…
                    </span>
                  ) : (
                    "Predict"
                  )}
                </button>

                <button className="btn" onClick={resetForm} disabled={predictLoading}>
                  Reset
                </button>

                <button
                  className="btn ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(form, null, 2));
                    showToast("Copied JSON 📋", "ok");
                  }}
                >
                  Copy JSON
                </button>
              </div>

              {error && (
                <div className="alert">
                  <div className="alertIcon">⚠️</div>
                  <div>
                    <div className="alertTitle">Request Error</div>
                    <div className="alertText">{error}</div>
                  </div>
                </div>
              )}
            </section>

            {/* Column 2: Prediction + Metrics */}
            <section className="stack">
              <div
                className={`card panel tilt ${prediction !== null ? "pop" : ""}`}
                onMouseMove={(e) => setCardTiltVars(e.currentTarget, e)}
                onMouseLeave={(e) => {
                  e.currentTarget.style.setProperty("--px", "0.5");
                  e.currentTarget.style.setProperty("--py", "0.5");
                }}
              >
                <div className="panelHead">
                  <div>
                    <h2>Prediction</h2>
                    <p className="muted">Raw unit + approximate USD.</p>
                  </div>
                  <span className="live">Live</span>
                </div>

                {prediction === null ? (
                  <div className="empty">
                    <div className="sparkle" aria-hidden="true">✦</div>
                    <h3>No prediction yet</h3>
                    <p className="muted">Fill the features and hit <b>Predict</b>.</p>
                    <div className="meterGhost"><span /></div>
                  </div>
                ) : (
                  <div className="result">
                    <div className="bigRow">
                      <div>
                        <div className="k">Model Output (MedHouseVal)</div>
                        <div className="big">{formatNum(predRawAnimated, 4)}</div>
                        <div className="muted tiny">Unit: <b>× $100k</b> (dataset convention)</div>
                      </div>

                      <div className="usdBox">
                        <div className="k">Approx Value (USD)</div>
                        <div className="usd">{formatUSD(predUsdAnimated)}</div>
                        <div className="muted tiny">≈ {formatNum(predRaw, 4)} × {formatUSD(TARGET_UNIT_MULTIPLIER_USD)}</div>
                      </div>
                    </div>

                    <div className="meter">
                      <div className="meterFill" style={{ width: `${meterPct}%` }} />
                      <div className="meterGlow" style={{ left: `${meterPct}%` }} />
                    </div>

                    <div className="miniGrid">
                      <div className="mini">
                        <div className="miniK">Endpoint</div>
                        <div className="miniV">/predict</div>
                      </div>
                      <div className="mini">
                        <div className="miniK">Features</div>
                        <div className="miniV">{fields.length}</div>
                      </div>
                      <div className="mini">
                        <div className="miniK">Backend</div>
                        <div className={`miniV ${serverOk ? "okTxt" : "badTxt"}`}>
                          {serverOk ? "OK" : "Down"}
                        </div>
                      </div>
                    </div>

                    <div className="note">
                      <span className="noteDot" />
                      <div className="muted tiny">
                        Note: dataset target is capped near 5.0; USD is approximate conversion for demo.
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div
                className="card panel tilt"
                onMouseMove={(e) => setCardTiltVars(e.currentTarget, e)}
                onMouseLeave={(e) => {
                  e.currentTarget.style.setProperty("--px", "0.5");
                  e.currentTarget.style.setProperty("--py", "0.5");
                }}
              >
                <div className="panelHead">
                  <div>
                    <h2>Model Metrics</h2>
                    <p className="muted">From <code>/metrics</code> (if available)</p>
                  </div>
                  <span className="pill">{metrics ? "Loaded" : "N/A"}</span>
                </div>

                {metrics ? (
                  <>
                    <div className="metricsGrid">
                      <div className="metric">
                        <div className="metricK">RMSE</div>
                        <div className="metricV">{formatNum(metrics.rmse, 4)}</div>
                        <div className="metricSub muted tiny">≈ {rmseUSD ? formatUSD(rmseUSD) : "—"}</div>
                      </div>
                      <div className="metric">
                        <div className="metricK">MAE</div>
                        <div className="metricV">{formatNum(metrics.mae, 4)}</div>
                        <div className="metricSub muted tiny">≈ {maeUSD ? formatUSD(maeUSD) : "—"}</div>
                      </div>
                      <div className="metric">
                        <div className="metricK">Model</div>
                        <div className="metricV">{metrics.model_type ?? "—"}</div>
                        <div className="metricSub muted tiny">alpha: {metrics.ridge_alpha ?? "—"}</div>
                      </div>
                    </div>

                    <div className="row">
                      <button className="btn ghost" onClick={() => window.open(`${API_BASE}/metrics`, "_blank")}>
                        View /metrics
                      </button>
                      <button
                        className="btn ghost"
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(metrics, null, 2));
                          showToast("Copied metrics 📋", "ok");
                        }}
                      >
                        Copy Metrics
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="muted tiny">
                    {metricsError || "No metrics found. Train first to generate artifacts/metrics.json."}
                  </div>
                )}
              </div>
            </section>

            {/* Column 3: Payload + Quick Links */}
            <aside className="stack">
              <div
                className="card panel tilt"
                onMouseMove={(e) => setCardTiltVars(e.currentTarget, e)}
                onMouseLeave={(e) => {
                  e.currentTarget.style.setProperty("--px", "0.5");
                  e.currentTarget.style.setProperty("--py", "0.5");
                }}
              >
                <div className="panelHead">
                  <div>
                    <h2>Payload</h2>
                    <p className="muted">This is sent to backend.</p>
                  </div>
                  <span className="pill">JSON</span>
                </div>

                <pre className="code">{JSON.stringify(form, null, 2)}</pre>

                <div className="row">
                  <button className="btn ghost" onClick={() => window.open(`${API_BASE}/schema`, "_blank")}>
                    View /schema
                  </button>
                  <button className="btn ghost" onClick={() => window.open(`${API_BASE}/health`, "_blank")}>
                    View /health
                  </button>
                  <button className="btn ghost" onClick={() => window.open(`${API_BASE}/docs`, "_blank")}>
                    Swagger
                  </button>
                </div>
              </div>

              <div className="card panel subtle">
                <div className="panelHead">
                  <div>
                    <h2>UX Goodies</h2>
                    <p className="muted">Small things that make it feel premium.</p>
                  </div>
                </div>

                <div className="goodies">
                  <div className="goodie">
                    <span className="dot a" />
                    <div>
                      <div className="goodieT">3D Tilt Cards</div>
                      <div className="muted tiny">Hover cards and move mouse.</div>
                    </div>
                  </div>
                  <div className="goodie">
                    <span className="dot b" />
                    <div>
                      <div className="goodieT">Count-up Animation</div>
                      <div className="muted tiny">Prediction numbers animate smoothly.</div>
                    </div>
                  </div>
                  <div className="goodie">
                    <span className="dot c" />
                    <div>
                      <div className="goodieT">Toast + Micro motion</div>
                      <div className="muted tiny">Copy/Reset/Predict feedback.</div>
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          </main>
        )}

        <footer className="footer">
          <span className="muted tiny">
            Tip: If fonts don’t load, it will fallback to system fonts (still OK).
          </span>
        </footer>
      </div>

      <style>{`
        /* Fonts (open-source). Falls back safely if blocked. */
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=Space+Grotesk:wght@400;600;700&display=swap');

        :root{
          --bg0:#060815;
          --bg1:#0A1030;
          --stroke: rgba(255,255,255,0.12);
          --text: rgba(255,255,255,0.94);
          --muted: rgba(255,255,255,0.70);
          --shadow: 0 22px 70px rgba(0,0,0,0.60);
          --r: 22px;

          --a:#8B5CF6;   /* violet */
          --b:#22D3EE;   /* cyan */
          --c:#FB7185;   /* rose */
          --d:#FBBF24;   /* amber */
          --ok:#22c55e;
          --bad:#fb7185;
        }

        *{ box-sizing:border-box; }
        body{
          margin:0;
          font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          color: var(--text);
          background:
            radial-gradient(1200px 700px at 16% 8%, rgba(139,92,246,0.22), transparent 60%),
            radial-gradient(1000px 700px at 85% 22%, rgba(34,211,238,0.16), transparent 55%),
            radial-gradient(900px 750px at 50% 95%, rgba(251,113,133,0.12), transparent 60%),
            linear-gradient(180deg, var(--bg0), var(--bg1));
          overflow-x:hidden;
        }

        .page{
          min-height:100vh;
          position:relative;
          --mx: 50vw;
          --my: 20vh;
        }

        .aurora{
          position:absolute; inset:-40%;
          background:
            radial-gradient(circle at 20% 20%, rgba(139,92,246,0.36), transparent 45%),
            radial-gradient(circle at 80% 25%, rgba(34,211,238,0.28), transparent 50%),
            radial-gradient(circle at 50% 80%, rgba(251,113,133,0.22), transparent 55%),
            radial-gradient(circle at 68% 55%, rgba(251,191,36,0.14), transparent 55%);
          filter: blur(26px);
          opacity: 0.88;
          animation: drift 14s ease-in-out infinite;
          pointer-events:none;
        }
        @keyframes drift{
          0%,100%{ transform: translate3d(0,0,0) scale(1.0); }
          50%{ transform: translate3d(34px,18px,0) scale(1.03); }
        }

        .noise{
          position:absolute; inset:0;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='.18'/%3E%3C/svg%3E");
          opacity: 0.10;
          mix-blend-mode: overlay;
          pointer-events:none;
        }

        .vignette{
          position:absolute; inset:0;
          background: radial-gradient(circle at 50% 10%, transparent 0%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0.55) 100%);
          pointer-events:none;
        }

        .shell{
          position: relative;
          width: min(1900px, calc(100vw - 32px));
          margin: 0 auto;
          padding: clamp(18px, 2.2vw, 28px) 0 16px;
        }

        .card{
          position:relative;
          border-radius: var(--r);
          background: linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.05));
          border: 1px solid var(--stroke);
          box-shadow: var(--shadow);
          backdrop-filter: blur(12px);
          overflow:hidden;
          transform-style: preserve-3d;
        }

        /* Neon gradient border */
        .card::before{
          content:"";
          position:absolute; inset:0;
          padding: 1px;
          border-radius: var(--r);
          background: linear-gradient(135deg, rgba(139,92,246,0.55), rgba(34,211,238,0.35), rgba(251,113,133,0.35));
          -webkit-mask:
            linear-gradient(#000 0 0) content-box,
            linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events:none;
          opacity: 0.55;
        }

        /* 3D Tilt effect */
        .tilt{
          --px: 0.5;
          --py: 0.5;
          transition: transform 220ms ease, box-shadow 220ms ease;
        }
        .tilt:hover{
          transform:
            perspective(1000px)
            rotateX(calc((0.5 - var(--py)) * 10deg))
            rotateY(calc((var(--px) - 0.5) * 12deg))
            translateY(-2px);
          box-shadow: 0 30px 90px rgba(0,0,0,0.65);
        }

        .topbar{
          display:flex;
          align-items:flex-start;
          justify-content: space-between;
          gap: 14px;
          padding: 18px;
          animation: enter 520ms ease-out both;
        }
        .topbar::after{
          content:"";
          position:absolute; inset:-2px;
          background: radial-gradient(520px 240px at var(--mx) var(--my), rgba(34,211,238,0.18), transparent 60%);
          pointer-events:none;
        }
        @keyframes enter{
          from{ transform: translateY(10px); opacity:0; }
          to{ transform: translateY(0); opacity:1; }
        }

        .brand{ display:flex; gap: 14px; align-items:flex-start; }
        .brandIcon{
          width: 52px; height: 52px;
          border-radius: 18px;
          display:grid; place-items:center;
          background: linear-gradient(135deg, rgba(139,92,246,0.90), rgba(34,211,238,0.75));
          border: 1px solid rgba(255,255,255,0.18);
          box-shadow: 0 14px 45px rgba(0,0,0,0.48);
          transform: rotate(-6deg);
          transition: transform 180ms ease;
        }
        .topbar:hover .brandIcon{ transform: rotate(-3deg) translateY(-1px); }

        .titleRow{ display:flex; align-items:center; gap: 10px; flex-wrap:wrap; }
        .title{
          margin:0;
          font-family: "Space Grotesk", Inter, system-ui, sans-serif;
          font-size: 32px;
          letter-spacing: 0.2px;
          background: linear-gradient(90deg, rgba(251,191,36,0.95), rgba(139,92,246,0.95), rgba(34,211,238,0.95));
          background-size: 200% 200%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: grad 6s ease-in-out infinite;
        }
        @keyframes grad{
          0%,100%{ background-position: 0% 50%; }
          50%{ background-position: 100% 50%; }
        }
        .subtitle{ margin:6px 0 0; color: var(--muted); font-size: 13px; }
        code{
          color: rgba(255,255,255,0.90);
          background: rgba(255,255,255,0.09);
          padding: 2px 7px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.12);
        }

        .status{
          font-size: 12px;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(0,0,0,0.18);
          color: rgba(255,255,255,0.85);
        }
        .status.ok{ border-color: rgba(34,197,94,0.35); background: rgba(34,197,94,0.10); }
        .status.bad{ border-color: rgba(251,113,133,0.35); background: rgba(251,113,133,0.10); }

        .topActions{ display:flex; gap: 10px; flex-wrap:wrap; justify-content:flex-end; }

        h2{
          margin:0;
          font-family: "Space Grotesk", Inter, system-ui, sans-serif;
          font-size: 18px;
          letter-spacing: 0.2px;
        }
        .muted{ color: var(--muted); }
        .tiny{ font-size: 12px; }

        .panel{ padding: 16px; }
        .panelHead{
          display:flex;
          align-items:flex-start;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 12px;
        }

        .pill{
          font-size: 12px;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(0,0,0,0.18);
        }
        .live{
          font-size: 12px;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid rgba(34,211,238,0.35);
          background: rgba(34,211,238,0.14);
        }

        .grid3{
          margin-top: 16px;
          display:grid;
          grid-template-columns: 1.25fr 0.95fr 0.95fr;
          gap: 16px;
          align-items:start;
          animation: enter 650ms ease-out both;
        }
        @media (max-width: 1280px){
          .grid3{ grid-template-columns: 1.25fr 0.85fr; }
          .grid3 > aside{ grid-column: 1 / -1; }
        }
        @media (max-width: 920px){
          .grid3{ grid-template-columns: 1fr; }
          .topbar{ flex-direction: column; align-items:flex-start; }
        }

        .stack{ display:flex; flex-direction:column; gap: 16px; }

        /* Hero loading */
        .hero{ padding: 18px; min-height: 150px; }
        .heroInner{ position:relative; z-index:2; }
        .shine{
          position:absolute; inset:-40%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
          transform: rotate(12deg);
          animation: shimmer 1.6s linear infinite;
          opacity:0.65;
          pointer-events:none;
        }
        @keyframes shimmer{
          0%{ transform: translateX(-35%) rotate(12deg); }
          100%{ transform: translateX(35%) rotate(12deg); }
        }
        .skeletonRow{ display:flex; gap: 10px; margin-top: 12px; }
        .sk{
          height: 12px; border-radius: 999px;
          background: rgba(255,255,255,0.10);
          flex: 1;
          animation: pulse 1.4s ease-in-out infinite;
        }
        @keyframes pulse{
          0%,100%{ opacity: 0.65; }
          50%{ opacity: 1; }
        }

        /* Search */
        .searchRow{
          display:flex;
          gap: 10px;
          align-items:center;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .searchWrap{
          flex: 1;
          position:relative;
        }
        .searchIcon{
          position:absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          opacity: 0.75;
          font-size: 14px;
        }
        .search{
          width: 100%;
          padding: 12px 36px 12px 34px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(0,0,0,0.22);
          color: var(--text);
          outline:none;
          transition: box-shadow 160ms ease, border-color 160ms ease, transform 140ms ease;
        }
        .search:focus{
          border-color: rgba(34,211,238,0.45);
          box-shadow: 0 0 0 5px rgba(34,211,238,0.14);
          transform: translateY(-1px);
        }
        .clearBtn{
          position:absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          border: 0;
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.85);
          width: 26px; height: 26px;
          border-radius: 10px;
          cursor:pointer;
        }

        /* Presets */
        .presetRow{
          display:flex; gap: 10px; flex-wrap:wrap;
          align-items:center;
          margin: 2px 0 12px;
        }
        .chipBtn{
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(0,0,0,0.18);
          color: rgba(255,255,255,0.88);
          padding: 6px 10px;
          border-radius: 999px;
          cursor:pointer;
          transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
        }
        .chipBtn:hover{
          transform: translateY(-1px);
          box-shadow: 0 12px 30px rgba(0,0,0,0.35);
          border-color: rgba(139,92,246,0.35);
        }

        /* Form */
        .formGrid{
          display:grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        @media (max-width: 620px){
          .formGrid{ grid-template-columns: 1fr; }
        }

        .field{ display:flex; flex-direction:column; gap: 8px; }
        .field.invalid .input{ border-color: rgba(251,113,133,0.55); box-shadow: 0 0 0 5px rgba(251,113,133,0.12); }
        .label{ display:flex; flex-direction:column; gap: 4px; }
        .labelName{ font-size: 13px; }
        .labelHint{ font-size: 12px; color: rgba(255,255,255,0.60); }

        .inputWrap{ position:relative; }
        .input{
          width: 100%;
          padding: 12px 12px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(0,0,0,0.22);
          color: var(--text);
          outline:none;
          transition: transform 140ms ease, box-shadow 160ms ease, border-color 160ms ease;
        }
        .input:focus{
          border-color: rgba(139,92,246,0.55);
          box-shadow: 0 0 0 5px rgba(139,92,246,0.16);
          transform: translateY(-1px);
        }
        .miniTag{
          position:absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 11px;
          padding: 4px 8px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.78);
          pointer-events:none;
        }
        .range{
          display:flex;
          justify-content: space-between;
          gap: 10px;
          font-size: 11px;
          color: rgba(255,255,255,0.55);
        }

        /* Buttons */
        .actions{ margin-top: 14px; display:flex; gap: 10px; flex-wrap:wrap; }
        .btn{
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.07);
          color: rgba(255,255,255,0.92);
          padding: 10px 12px;
          border-radius: 16px;
          cursor:pointer;
          transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease;
          user-select:none;
          position:relative;
          overflow:hidden;
        }
        .btn:hover{
          transform: translateY(-1px);
          box-shadow: 0 14px 40px rgba(0,0,0,0.40);
        }
        .btn:active{ transform: translateY(0px) scale(0.99); }
        .btn:disabled{ opacity: 0.6; cursor:not-allowed; }

        .btn.primary{
          background: linear-gradient(135deg, rgba(139,92,246,0.92), rgba(34,211,238,0.70));
          border-color: rgba(139,92,246,0.35);
        }
        .btn.primary::after{
          content:"";
          position:absolute; inset:-40%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent);
          transform: rotate(15deg) translateX(-25%);
          opacity: 0;
          transition: opacity 160ms ease;
        }
        .btn.primary:hover::after{
          opacity: 1;
          animation: btnShine 1.2s linear infinite;
        }
        @keyframes btnShine{
          0%{ transform: rotate(15deg) translateX(-25%); }
          100%{ transform: rotate(15deg) translateX(25%); }
        }

        .btn.ghost{ background: rgba(0,0,0,0.18); }
        .tinyBtn{ padding: 10px 10px; font-size: 12px; }

        .btnInline{ display:flex; align-items:center; gap: 10px; }
        .spinner{
          width: 14px; height: 14px;
          border-radius: 999px;
          border: 2px solid rgba(255,255,255,0.25);
          border-top-color: rgba(255,255,255,0.92);
          animation: spin 700ms linear infinite;
        }
        @keyframes spin{ to{ transform: rotate(360deg); } }

        /* Alert */
        .alert{
          margin-top: 14px;
          display:flex;
          gap: 10px;
          align-items:flex-start;
          border-radius: 18px;
          padding: 12px;
          border: 1px solid rgba(251,113,133,0.35);
          background: rgba(251,113,133,0.10);
          animation: popIn 420ms ease both;
        }
        @keyframes popIn{
          0%{ transform: translateY(6px); opacity: 0.7; }
          100%{ transform: translateY(0); opacity: 1; }
        }
        .alertIcon{ width: 28px; height:28px; display:grid; place-items:center; }
        .alertTitle{ font-weight: 800; font-size: 13px; }
        .alertText{ font-size: 13px; color: rgba(255,255,255,0.82); }

        /* Prediction */
        .empty{
          padding: 18px;
          border-radius: 18px;
          border: 1px dashed rgba(255,255,255,0.16);
          background: rgba(0,0,0,0.16);
          text-align:center;
        }
        .sparkle{
          font-size: 28px;
          display:inline-block;
          animation: sparkle 1.6s ease-in-out infinite;
        }
        @keyframes sparkle{
          0%,100%{ transform: translateY(0px) rotate(0deg); opacity:0.9; }
          50%{ transform: translateY(-4px) rotate(6deg); opacity:1; }
        }

        .meterGhost{
          height: 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(0,0,0,0.20);
          margin-top: 14px;
          overflow:hidden;
        }
        .meterGhost span{
          display:block; height:100%;
          width: 35%;
          background: linear-gradient(90deg, rgba(139,92,246,0.55), rgba(34,211,238,0.55));
          animation: ghost 1.6s ease-in-out infinite;
        }
        @keyframes ghost{
          0%,100%{ transform: translateX(-10%); opacity: 0.65; }
          50%{ transform: translateX(160%); opacity: 1; }
        }

        .result{ padding: 2px 2px 2px; }
        .bigRow{
          display:grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          align-items:start;
        }
        @media (max-width: 520px){
          .bigRow{ grid-template-columns: 1fr; }
        }

        .k{ font-size: 12px; color: rgba(255,255,255,0.68); }
        .big{
          font-family: "Space Grotesk", Inter, system-ui, sans-serif;
          font-size: 42px;
          font-weight: 800;
          letter-spacing: 0.3px;
          line-height: 1.05;
          background: linear-gradient(135deg, rgba(251,191,36,0.95), rgba(139,92,246,0.95), rgba(34,211,238,0.95));
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          filter: drop-shadow(0 12px 30px rgba(0,0,0,0.35));
          margin-top: 6px;
        }

        .usdBox{
          border-radius: 18px;
          padding: 12px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(0,0,0,0.18);
        }
        .usd{
          font-family: "Space Grotesk", Inter, system-ui, sans-serif;
          font-size: 28px;
          font-weight: 800;
          margin-top: 6px;
          background: linear-gradient(90deg, rgba(34,211,238,0.95), rgba(139,92,246,0.95), rgba(251,191,36,0.95));
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }

        .meter{
          position:relative;
          height: 12px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(0,0,0,0.22);
          margin-top: 14px;
          overflow:hidden;
        }
        .meterFill{
          height:100%;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(251,191,36,0.85), rgba(139,92,246,0.85), rgba(34,211,238,0.85));
          transition: width 520ms cubic-bezier(.2,.9,.2,1);
        }
        .meterGlow{
          position:absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 18px; height: 18px;
          border-radius: 999px;
          background: rgba(255,255,255,0.22);
          filter: blur(4px);
          transition: left 520ms cubic-bezier(.2,.9,.2,1);
          pointer-events:none;
        }

        .miniGrid{
          margin-top: 14px;
          display:grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .mini{
          border-radius: 16px;
          padding: 10px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(0,0,0,0.18);
        }
        .miniK{ font-size: 11px; color: rgba(255,255,255,0.62); }
        .miniV{ margin-top: 4px; font-weight: 800; }
        .okTxt{ color: var(--ok); }
        .badTxt{ color: var(--bad); }

        .note{
          margin-top: 12px;
          display:flex;
          gap: 10px;
          align-items:flex-start;
          border-radius: 16px;
          padding: 10px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(0,0,0,0.16);
        }
        .noteDot{
          width: 10px; height: 10px;
          border-radius: 999px;
          margin-top: 4px;
          background: rgba(251,191,36,0.95);
          box-shadow: 0 12px 30px rgba(0,0,0,0.35);
        }

        .pop{ animation: popCard 420ms cubic-bezier(.2,.9,.2,1) both; }
        @keyframes popCard{
          0%{ transform: scale(0.985); opacity: 0.75; }
          100%{ transform: scale(1); opacity: 1; }
        }

        /* Metrics */
        .metricsGrid{
          display:grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        @media (max-width: 520px){
          .metricsGrid{ grid-template-columns: 1fr; }
        }
        .metric{
          border-radius: 16px;
          padding: 10px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(0,0,0,0.18);
        }
        .metricK{ font-size: 11px; color: rgba(255,255,255,0.62); }
        .metricV{ margin-top: 4px; font-weight: 900; font-size: 16px; }
        .metricSub{ margin-top: 2px; }

        /* Payload */
        .code{
          margin: 0;
          font-size: 12px;
          line-height: 1.55;
          padding: 12px;
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(0,0,0,0.22);
          max-height: 360px;
          overflow:auto;
        }
        .subtle::before{ opacity: 0.30; }

        /* Goodies */
        .goodies{ display:flex; flex-direction:column; gap: 10px; }
        .goodie{ display:flex; gap: 10px; align-items:flex-start; }
        .dot{ width: 10px; height: 10px; border-radius: 999px; margin-top: 4px; }
        .dot.a{ background: rgba(34,211,238,0.95); }
        .dot.b{ background: rgba(139,92,246,0.95); }
        .dot.c{ background: rgba(251,191,36,0.95); }
        .goodieT{ font-weight: 900; font-size: 13px; }

        .row{ display:flex; gap: 10px; flex-wrap:wrap; align-items:center; margin-top: 10px; }

        .footer{
          margin-top: 14px;
          text-align:center;
          padding: 8px 0 2px;
          opacity: 0.95;
        }

        /* Toast */
        .toast{
          position: fixed;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 99;
          display:flex;
          gap: 10px;
          align-items:center;
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(0,0,0,0.25);
          backdrop-filter: blur(12px);
          box-shadow: 0 18px 60px rgba(0,0,0,0.55);
          animation: toastIn 260ms ease-out both;
        }
        .toast.ok{ border-color: rgba(34,197,94,0.25); }
        .toast.bad{ border-color: rgba(251,113,133,0.25); }
        .toastDot{
          width: 10px; height: 10px; border-radius: 999px;
          background: linear-gradient(135deg, rgba(139,92,246,0.95), rgba(34,211,238,0.95));
        }
        .toast.bad .toastDot{ background: rgba(251,113,133,0.95); }
        .toastMsg{ font-size: 13px; font-weight: 700; }
        @keyframes toastIn{
          from{ opacity: 0; transform: translateX(-50%) translateY(-6px); }
          to{ opacity: 1; transform: translateX(-50%) translateY(0); }
        }

        /* Reduced motion */
        @media (prefers-reduced-motion: reduce){
          .aurora, .shine, .sparkle, .btn.primary:hover::after, .pop, .toast { animation:none !important; }
          .meterFill, .meterGlow, .tilt { transition:none !important; }
        }
      `}</style>
    </div>
  );
}
