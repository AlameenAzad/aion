const Nav = () => {
  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <a className="nav-brand" href="#">
          <span className="mark" aria-hidden="true"></span>
          <span>Aion</span>
        </a>
        <div className="nav-links">
          <a href="#how">How it works</a>
          <a href="#run">Sync run</a>
          <a href="#faq">FAQ</a>
          <a href="https://github.com/alameenazad/aion">GitHub</a>
        </div>
        <div className="nav-right">
          <a className="btn btn-ghost" href="https://github.com/alameenazad/aion/blob/main/README.md">Docs</a>
          <a className="btn btn-primary" href="https://www.npmjs.com/package/aion-sync">
            Install <span className="chev">↗</span>
          </a>
        </div>
      </div>
    </nav>
  );
};

window.Nav = Nav;
