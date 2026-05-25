const { useEffect, useRef, useState: useStateHero } = React;

// Animated orbit: Aion compass mark at center, 3 sources on outer ring, Dyce on the right.
// Particles flow source→core and core→dest, leaving trails. Hover a source to focus its channel.
const SyncOrbit = () => {
  const [tick, setTick] = useStateHero(0);
  const [hovered, setHovered] = useStateHero(null);

  useEffect(() => {
    let raf;
    const start = performance.now();
    const loop = (now) => {
      setTick((now - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // canvas
  const W = 600, H = 600;
  const cx = W / 2, cy = H / 2;
  const ringInner = 130;
  const ringOuter = 230;
  const tickRing  = ringOuter + 46;

  const sources = [
    { id: "tempo", label: "Tempo", angle: 200 },
    { id: "jira",  label: "Jira",  angle: 250 },
    { id: "paser", label: "Paser", angle: 290 },
  ];
  const dest = { id: "dyce", label: "Dyce", angle: 0 };

  const xy = (deg, r) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r };
  };

  // Channel emphasis from hover
  const channelEmphasis = (id) => {
    if (!hovered) return 0.7;
    return id === hovered ? 1.0 : 0.22;
  };

  // -------- Particle trails --------
  const particles = [];
  const TRAIL = 5;
  const TRAIL_STEP = 0.04;
  const emit = (from, to, count, speed, channelKey, emphasis) => {
    for (let i = 0; i < count; i++) {
      const headT = ((tick * speed + i / count) % 1);
      for (let k = 0; k < TRAIL; k++) {
        const t = headT - k * TRAIL_STEP;
        if (t < 0 || t > 1) continue;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t;
        const env = Math.sin(t * Math.PI);
        const trailFade = (1 - k / TRAIL);
        particles.push({
          key: `${channelKey}-${i}-${k}`,
          x, y,
          op: env * trailFade * emphasis,
          r: 2.8 * trailFade + 0.5,
        });
      }
    }
  };
  sources.forEach((s, si) => {
    const from = xy(s.angle, ringOuter - 36);
    const to = xy(s.angle, 70);
    emit(from, to, 3, 0.45, `s${si}`, channelEmphasis(s.id));
  });
  // Dyce channel: 3 particles, slower speed → ~1.5 arrivals / sec
  const DEST_SPEED = 0.5;
  const DEST_COUNT = 3;
  const destEdge = xy(dest.angle, ringOuter - 36);
  const coreEdge = xy(dest.angle, 70);
  emit(coreEdge, destEdge, DEST_COUNT, DEST_SPEED, 'd', hovered ? 0.85 : 0.7);

  // -------- Dyce arrival flash (smooth decay) --------
  // Arrival rate = DEST_COUNT * DEST_SPEED arrivals/sec; cycle 0→1 between arrivals.
  const arrivalRate = DEST_COUNT * DEST_SPEED;
  const arrivalCycle = (tick * arrivalRate) % 1;
  // Exponential decay — sharp at the moment of arrival, fades smoothly to ~0.05
  const destFlash = Math.exp(-arrivalCycle * 5);

  // Source breathing (subtle, independent)
  const sourceBreath = (i) => 1 + 0.04 * Math.sin(tick * 1.6 + i * 2.1);

  const Node = ({ id, pos, label, accent, scale = 1, flash = 0, dim = 0, onEnter, onLeave }) => {
    const opacity = 1 - dim * 0.55;
    return (
      <g
        className="orbit-node"
        transform={`translate(${pos.x}, ${pos.y}) scale(${scale})`}
        style={{ cursor: onEnter ? 'pointer' : 'default', transition: 'opacity 240ms ease' }}
        opacity={opacity}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        {onEnter && <circle r="56" fill="transparent" />}
        <circle
          r="50"
          fill={accent ? `rgba(212,255,58,${0.08 + flash * 0.12})` : `rgba(255,255,255,${0.03 + (id === hovered ? 0.08 : 0)})`}
          style={{ transition: accent ? 'fill 280ms ease' : undefined }}
        />
        <circle className="outer" r="36" />
        <circle className="inner" r="28" />
        {(accent || id === hovered) && (
          <circle
            r="36"
            fill="none"
            stroke={accent
              ? `rgba(212,255,58,${0.55 + flash * 0.15})`
              : 'rgba(212,255,58,0.55)'}
            strokeWidth={accent ? 1.5 + flash * 0.5 : 1.5}
            style={{ transition: accent ? 'stroke 280ms ease, stroke-width 280ms ease' : undefined }}
          />
        )}
        <text dy="3" fontSize="12.5" fontWeight="500" fill="#eaf3ff" fontFamily="Geist, sans-serif">
          {label}
        </text>
      </g>
    );
  };

  // Inner ring dots
  const innerDots = Array.from({ length: 8 }).map((_, i) => {
    const a = (tick * -22 + i * 45) % 360;
    const p = xy(a, ringInner);
    return <circle key={`id-${i}`} cx={p.x} cy={p.y} r="1.8" fill="rgba(255,255,255,0.22)" />;
  });

  // Outer ticks (slow counter-rotation)
  const tickRot = (tick * 4) % 360;

  return (
    <div
      className="orbit-wrap"
      onMouseLeave={() => setHovered(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="orbit-svg" aria-hidden="true">
        <defs>
          <radialGradient id="coreHalo" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#d4ff3a" stopOpacity="0.55" />
            <stop offset="35%"  stopColor="#d4ff3a" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#d4ff3a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="coreFill" cx="40%" cy="35%" r="65%">
            <stop offset="0%"   stopColor="#23272d" />
            <stop offset="100%" stopColor="#0a0b0d" />
          </radialGradient>
          <linearGradient id="ringFade" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor="rgba(255,255,255,0.02)" />
            <stop offset="50%"  stopColor="rgba(255,255,255,0.22)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
          </linearGradient>
          <linearGradient id="connBright" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="rgba(212,255,58,0.05)" />
            <stop offset="100%" stopColor="rgba(212,255,58,0.55)" />
          </linearGradient>
          <filter id="glowSoft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        <circle cx={cx} cy={cy} r="200" fill="url(#coreHalo)" />

        {/* Outer tick marks */}
        <g transform={`rotate(${tickRot} ${cx} ${cy})`}>
          {Array.from({ length: 72 }).map((_, i) => {
            const a = (i * 5) * Math.PI / 180;
            const major = i % 6 === 0;
            const r1 = tickRing;
            const r2 = r1 + (major ? 9 : 4);
            return (
              <line
                key={`t-${i}`}
                x1={cx + Math.cos(a) * r1}
                y1={cy + Math.sin(a) * r1}
                x2={cx + Math.cos(a) * r2}
                y2={cy + Math.sin(a) * r2}
                stroke={major ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.09)"}
                strokeWidth="1"
              />
            );
          })}
        </g>

        {/* Rings */}
        <circle cx={cx} cy={cy} r={ringInner} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1" strokeDasharray="2 5" />
        <circle cx={cx} cy={cy} r={ringOuter} fill="none" stroke="url(#ringFade)" strokeWidth="1.25" />

        {/* Connecting lines */}
        {sources.map((s) => {
          const p = xy(s.angle, ringOuter - 36);
          const emp = channelEmphasis(s.id);
          return (
            <line
              key={`l-${s.id}`}
              x1={cx + Math.cos(s.angle * Math.PI / 180) * 70}
              y1={cy + Math.sin(s.angle * Math.PI / 180) * 70}
              x2={p.x}
              y2={p.y}
              stroke={s.id === hovered ? "rgba(212,255,58,0.55)" : "rgba(255,255,255,0.10)"}
              strokeWidth={s.id === hovered ? 1.5 : 1}
              opacity={emp}
              style={{ transition: 'stroke 240ms ease, opacity 240ms ease, stroke-width 240ms ease' }}
            />
          );
        })}
        <line
          x1={cx + Math.cos(0) * 70}
          y1={cy}
          x2={cx + Math.cos(0) * (ringOuter - 36)}
          y2={cy}
          stroke="url(#connBright)"
          strokeWidth="1.5"
        />

        {innerDots}

        {particles.map((p) => (
          <circle
            key={p.key}
            cx={p.x}
            cy={p.y}
            r={p.r}
            fill="#d4ff3a"
            opacity={p.op}
            style={{ filter: 'drop-shadow(0 0 4px rgba(212,255,58,0.8))' }}
          />
        ))}

        {sources.map((s, i) => {
          const p = xy(s.angle, ringOuter - 36);
          const dim = hovered && hovered !== s.id ? 1 : 0;
          return (
            <Node
              key={s.id}
              id={s.id}
              pos={p}
              label={s.label}
              scale={sourceBreath(i)}
              dim={dim}
              onEnter={() => setHovered(s.id)}
              onLeave={() => setHovered(null)}
            />
          );
        })}

        <Node id="dyce" pos={xy(0, ringOuter - 36)} label="Dyce" accent flash={destFlash} />

        {/* CORE */}
        <g transform={`translate(${cx}, ${cy})`}>
          <circle r="86" fill="none" stroke="rgba(212,255,58,0.10)" strokeWidth="20" filter="url(#glowSoft)" />
          <circle r="68" fill="url(#coreFill)" stroke="rgba(212,255,58,0.55)" strokeWidth="1.5" />
          <circle r="52" fill="none" stroke="rgba(212,255,58,0.18)" strokeWidth="1" strokeDasharray="3 6" />
          <foreignObject x="-50" y="-50" width="100" height="100" style={{ overflow: 'visible' }}>
            <div xmlns="http://www.w3.org/1999/xhtml" className="core-mark">
              <div className="core-mark-ring" />
              <div className="core-mark-hole" />
            </div>
          </foreignObject>
        </g>
      </svg>

      <div className="orbit-label" style={{ top: '6%', left: '4%' }}>SOURCES</div>
      <div className="orbit-label" style={{ top: '6%', right: '4%', color: '#d4ff3a', borderColor: 'rgba(212,255,58,0.4)' }}>DESTINATION</div>

      <div className="orbit-label" style={{ bottom: '4%', left: '50%', transform: 'translateX(-50%)', color: hovered ? '#d4ff3a' : '#7e828a', borderColor: hovered ? 'rgba(212,255,58,0.4)' : undefined, transition: 'color 240ms ease, border-color 240ms ease' }}>
        {hovered ? `${hovered.toUpperCase()} → AION → DYCE` : 'AION · SYNC ENGINE'}
      </div>
    </div>
  );
};

const Hero = () => {
  const [version, setVersion] = useStateHero(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // npm registry — has CORS, returns latest published version
        const res = await fetch('https://registry.npmjs.org/aion-sync/latest');
        if (!res.ok) throw new Error('npm fetch failed');
        const data = await res.json();
        if (!cancelled && data.version) {
          setVersion('v' + data.version);
          return;
        }
      } catch (_) { /* fall through */ }
      try {
        // fallback: GitHub releases
        const res = await fetch('https://api.github.com/repos/alameenazad/aion/releases/latest', {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) throw new Error('gh fetch failed');
        const data = await res.json();
        if (!cancelled && data.tag_name) {
          setVersion(data.tag_name.startsWith('v') ? data.tag_name : 'v' + data.tag_name);
        }
      } catch (_) {
        if (!cancelled) setVersion('latest');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="hero">
      <div className="wrap hero-inner">
        <div>
          <div className="hero-eyebrow">
            <span className="dot">A</span>
            <span>aion-sync</span>
            <span className="sep">/</span>
            <span style={{ opacity: version ? 1 : 0.5, transition: 'opacity 240ms ease' }}>
              {version || 'v…'}
            </span>
            <span className="sep">/</span>
            <span>node ≥ 18</span>
          </div>
          <h1 className="hero-title">
            <span className="stack">Sync once.</span>
            <span className="stack"><span className="italic">Flow</span> forever.</span>
          </h1>
          <p className="hero-lede">
            Aion is the quiet bridge between Tempo, Jira, Paser and Dyce. Connect once, preview every run,
            and write only what should be written — without the spreadsheet hangover.
          </p>
          <div className="hero-ctas">
            <a className="btn btn-primary" href="#run">Try a sync run <span className="chev">→</span></a>
            <a className="btn" href="https://github.com/alameenazad/aion">View source</a>
          </div>
          <div className="hero-meta">
            <div><b>4</b> · providers</div>
            <div><b>5</b> · commands</div>
            <div><b>0</b> · duplicate writes</div>
            <div><b>~2 min</b> · setup</div>
          </div>
        </div>
        <SyncOrbit />
      </div>
    </section>
  );
};

window.Hero = Hero;
