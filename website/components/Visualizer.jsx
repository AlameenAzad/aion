const { useState: useStateViz, useEffect: useEffectViz, useRef: useRefViz, useMemo: useMemoViz } = React;

// Fake data for the preview diff
const PREVIEW_ROWS = [
  { ticket: "ENG-3128", title: "Sync log dedupe race condition",  hrs: "2h 15m", date: "Mon",  action: "create" },
  { ticket: "ENG-3119", title: "Mapping engine: leave routing",   hrs: "1h 30m", date: "Mon",  action: "create" },
  { ticket: "ENG-3140", title: "Provider auth retry logic",       hrs: "0h 45m", date: "Tue",  action: "create" },
  { ticket: "INFRA-77", title: "Bump node runtime to 20.11",      hrs: "3h 00m", date: "Tue",  action: "skip"   },
  { ticket: "ENG-3151", title: "Preview table — colorized diff",  hrs: "1h 50m", date: "Wed",  action: "create" },
  { ticket: "ENG-3152", title: "Config exporter polish",          hrs: "2h 30m", date: "Wed",  action: "create" },
  { ticket: "ENG-3158", title: "Paser leave: half-day mapping",   hrs: "0h 30m", date: "Thu",  action: "create" },
  { ticket: "DOC-12",   title: "README quick-start refresh",      hrs: "1h 15m", date: "Thu",  action: "skip"   },
];

const PROVIDERS_INITIAL = [
  { id: "tempo", name: "Tempo",  meta: "tempo.io",     state: "idle" },
  { id: "jira",  name: "Jira",   meta: "api v3",       state: "idle" },
  { id: "paser", name: "Paser",  meta: "v2 endpoints", state: "idle" },
  { id: "dyce",  name: "Dyce",   meta: "token: 6d",    state: "idle" },
];

// Tiny SVG sparkline (sync duration over last 14 runs)
const Sparkline = ({ values }) => {
  const W = 260, H = 60, pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (W - pad * 2);
    const y = pad + (1 - (v - min) / range) * (H - pad * 2);
    return [x, y];
  });
  const d = pts.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(" ");
  const area = `${d} L ${W - pad} ${H - pad} L ${pad} ${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d4ff3a" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#d4ff3a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkFill)" />
      <path d={d} fill="none" stroke="#d4ff3a" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3 : 1.6} fill={i === pts.length - 1 ? "#d4ff3a" : "rgba(212,255,58,0.6)"} />
      ))}
    </svg>
  );
};

const Visualizer = () => {
  const [step, setStep] = useStateViz(0); // 0 status, 1 preview, 2 sync
  const [providers, setProviders] = useStateViz(PROVIDERS_INITIAL);
  const [running, setRunning] = useStateViz(false);
  const [syncedCount, setSyncedCount] = useStateViz(0);
  const [logLines, setLogLines] = useStateViz([]);
  const [progress, setProgress] = useStateViz(0);
  const timersRef = useRefViz([]);

  const toSync = useMemoViz(() => PREVIEW_ROWS.filter((r) => r.action === "create"), []);
  const skipCount = PREVIEW_ROWS.length - toSync.length;

  const clearTimers = () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  };
  useEffectViz(() => () => clearTimers(), []);

  const schedule = (fn, ms) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
  };

  const resetAll = () => {
    clearTimers();
    setRunning(false);
    setProviders(PROVIDERS_INITIAL);
    setSyncedCount(0);
    setLogLines([]);
    setProgress(0);
    setStep(0);
  };

  const runStatus = () => {
    setProviders((p) => p.map((x) => ({ ...x, state: "connecting" })));
    PROVIDERS_INITIAL.forEach((prov, i) => {
      schedule(() => {
        setProviders((p) => p.map((x) => (x.id === prov.id ? { ...x, state: "ok" } : x)));
      }, 350 + i * 280);
    });
  };

  const runSyncSequence = () => {
    setProgress(0);
    setSyncedCount(0);
    setLogLines([
      { tone: "muted", text: "$ aion sync --today" },
      { tone: "info",  text: "→ resolving sync plan from preview…" },
    ]);
    const N = toSync.length;
    toSync.forEach((row, i) => {
      schedule(() => {
        setSyncedCount(i + 1);
        setProgress(((i + 1) / N) * 100);
        setLogLines((l) => [
          ...l,
          { tone: "ok", text: `✓ ${row.ticket}  ${row.title}  (${row.hrs})` },
        ]);
      }, 500 + i * 380);
    });
    schedule(() => {
      setLogLines((l) => [
        ...l,
        { tone: "dim", text: "" },
        { tone: "muted", text: "writing ~/.aion/synced.json" },
        { tone: "ok", text: `done · ${N} created · ${skipCount} skipped · 0 failed  (1.8s)` },
      ]);
      setRunning(false);
    }, 500 + N * 380 + 280);
  };

  const runFullDemo = () => {
    resetAll();
    setRunning(true);
    setStep(0);
    runStatus();
    schedule(() => setStep(1), 350 + PROVIDERS_INITIAL.length * 280 + 400);
    schedule(() => setStep(2), 350 + PROVIDERS_INITIAL.length * 280 + 400 + 1400);
    schedule(() => runSyncSequence(), 350 + PROVIDERS_INITIAL.length * 280 + 400 + 1400 + 200);
  };

  // Side-panel sparkline data
  const sparkData = [3.2, 2.6, 2.9, 2.4, 2.8, 2.1, 2.3, 1.9, 2.0, 1.7, 1.8, 1.6, 1.7, 1.8];

  const stepCmds = [
    { name: "status",  cmd: "aion status",          desc: "verify connectivity to all providers"            },
    { name: "preview", cmd: "aion preview --today", desc: "dry-run with enrichment + leave routing"         },
    { name: "sync",    cmd: "aion sync --today",    desc: "create only missing records — idempotent"        },
  ];

  return (
    <section id="run" className="section">
      <div className="wrap">
        <div className="section-head">
          <div>
            <span className="section-tag">02 · sync run</span>
            <h2 className="section-title">Watch a run <span className="italic">end-to-end.</span></h2>
          </div>
          <p className="section-sub">
            Three commands, one quiet write. Step through them yourself, or hit run and watch the whole pipeline
            light up — same flow you get in your terminal.
          </p>
        </div>

        <div className="viz">
          <div className="viz-toolbar">
            <div className="left">
              <div className="dots"><span className="live"></span><span></span><span></span></div>
              <div className="crumbs">
                <span>~/projects/aion</span>
                <span className="sep">›</span>
                <span style={{ color: '#d4ff3a' }}>session · today</span>
              </div>
            </div>
            <div className="left" style={{ color: '#7e828a' }}>
              <span>{new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
              <span className="sep">·</span>
              <span>{toSync.length} ready · {skipCount} skipped</span>
            </div>
          </div>

          <div className="viz-body">
            {/* Steps rail */}
            <div className="steps">
              {stepCmds.map((s, i) => (
                <div
                  key={s.name}
                  className={`step ${step === i ? 'active' : ''} ${step > i ? 'done' : ''}`}
                  onClick={() => !running && setStep(i)}
                >
                  <div className="step-num">{step > i ? '✓' : String(i + 1).padStart(2, '0')}</div>
                  <div className="step-body">
                    <div className="name">aion {s.name}</div>
                    <div className="desc">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Stage */}
            <div className="stage">
              <div className="stage-head">
                <div className="stage-cmd">
                  <span className="prompt">$</span>
                  <span>aion </span>
                  <span className="cmd-accent">{stepCmds[step].name}</span>
                  {step === 1 && <span style={{ color: '#7e828a' }}> --today</span>}
                  {step === 2 && <span style={{ color: '#7e828a' }}> --today</span>}
                </div>
                {running ? (
                  <span className="stage-status live"><span className="pulse"></span> running</span>
                ) : (
                  <span className="stage-status">idle</span>
                )}
              </div>

              {step === 0 && (
                <div className="providers">
                  {providers.map((p) => (
                    <div key={p.id} className={`provider ${p.state}`}>
                      <div>
                        <div className="name">{p.name}</div>
                        <div className="meta">{p.meta}</div>
                      </div>
                      <div className="badge">
                        {p.state === "ok" ? "● connected" : p.state === "connecting" ? "○ connecting" : "· idle"}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {step === 1 && (
                <div className="diff-table">
                  <div className="diff-head">
                    <div>id</div>
                    <div>worklog</div>
                    <div>hrs</div>
                    <div className="col-date">day</div>
                    <div style={{ textAlign: 'right' }}>action</div>
                  </div>
                  {PREVIEW_ROWS.map((r, i) => (
                    <div key={i} className={`diff-row ${r.action === 'skip' ? 'skip' : ''}`}>
                      <div className="ticket">{r.ticket}</div>
                      <div className="title">{r.title}</div>
                      <div className="hrs">{r.hrs}</div>
                      <div className="date">{r.date}</div>
                      <div className={`action ${r.action}`}>{r.action === 'create' ? '+ create' : '— skip'}</div>
                    </div>
                  ))}
                </div>
              )}

              {step === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="sync-stats">
                    <div className="sync-stat">
                      <div className="label">created</div>
                      <div className="value good">{syncedCount}</div>
                    </div>
                    <div className="sync-stat">
                      <div className="label">skipped</div>
                      <div className="value">{skipCount}</div>
                    </div>
                    <div className="sync-stat">
                      <div className="label">failed</div>
                      <div className="value">0</div>
                    </div>
                  </div>
                  <div className="sync-progress">
                    <div className="label">
                      <span>writing dyce entries</span>
                      <span>{Math.round(progress)}%</span>
                    </div>
                    <div className="bar"><div style={{ width: `${progress}%` }}></div></div>
                  </div>
                  <div className="sync-log">
                    {logLines.length === 0 ? (
                      <div className="muted">— waiting · click "Run pipeline" to start —</div>
                    ) : (
                      logLines.map((ln, i) => (
                        <div key={i} className={ln.tone}>{ln.text || '\u00A0'}</div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Side panel */}
            <aside className="side">
              <div>
                <h4>Run context</h4>
                <div className="kv" style={{ marginTop: 10 }}>
                  <div className="k">window</div><div className="v">today</div>
                  <div className="k">policy</div><div className="v">skip-existing</div>
                  <div className="k">enrich</div><div className="v">jira-titles</div>
                  <div className="k">leave</div><div className="v">paser → routing</div>
                  <div className="k">log</div><div className="v">~/.aion/synced.json</div>
                </div>
              </div>

              <div className="spark">
                <div className="head">
                  <span className="lbl">avg sync · last 14</span>
                  <span className="num">1.8s</span>
                </div>
                <Sparkline values={sparkData} />
              </div>

              <button
                className="btn btn-primary run-btn"
                onClick={runFullDemo}
                disabled={running}
              >
                {running ? 'Running pipeline…' : 'Run pipeline ▸'}
              </button>
              <button className="reset-btn" onClick={resetAll}>Reset</button>
            </aside>
          </div>
        </div>

        {/* Kicker strip */}
        <div id="how" className="kicker-strip">
          <div className="kicker">
            <div className="num">01 / connect</div>
            <h3>One auth, four providers</h3>
            <p>Guided setup wires up Tempo, Jira, Paser and Dyce in under two minutes.</p>
          </div>
          <div className="kicker">
            <div className="num">02 / preview</div>
            <h3>See the run before it runs</h3>
            <p>A dry-run table shows every row, enriched and routed, with no side effects.</p>
          </div>
          <div className="kicker">
            <div className="num">03 / sync</div>
            <h3>Idempotent by default</h3>
            <p>A local sync log keeps reruns safe. Same day twice means zero duplicate writes.</p>
          </div>
          <div className="kicker">
            <div className="num">04 / verify</div>
            <h3>Status before every cycle</h3>
            <p>Connectivity, token expiry and provider health checked before any expensive call.</p>
          </div>
        </div>
      </div>
    </section>
  );
};

window.Visualizer = Visualizer;
