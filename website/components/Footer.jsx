const { useState: useStateFooter } = React;

const FooterCta = () => {
  const [copied, setCopied] = useStateFooter(false);
  const cmd = "npm install -g aion-sync";
  const copy = () => {
    navigator.clipboard?.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <section className="section" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="footer-cta">
          <h2>Reclaim Friday <span className="italic">afternoon.</span></h2>
          <p>One install. One setup. Then a sync that runs itself and stays out of your way.</p>
          <div className="ctas">
            <a className="btn btn-primary" href="https://www.npmjs.com/package/aion-sync">Install Aion</a>
            <a className="btn" href="https://github.com/alameenazad/aion">Read the source</a>
          </div>
          <div className="install">
            <span className="prompt">$</span>
            <span>{cmd}</span>
            <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={copy}>{copied ? '✓ copied' : 'copy'}</button>
          </div>
        </div>
        <footer className="foot">
          <div className="mono">© 2026 · aion-sync · MIT</div>
          <div style={{ display: 'flex', gap: 24 }}>
            <a href="https://github.com/alameenazad/aion/blob/main/README.md">Docs</a>
            <a href="https://github.com/alameenazad/aion/releases">Releases</a>
            <a href="https://github.com/alameenazad/aion/issues">Issues</a>
            <a href="https://github.com/alameenazad/aion/blob/main/LICENSE">License</a>
          </div>
        </footer>
      </div>
    </section>
  );
};

window.FooterCta = FooterCta;
