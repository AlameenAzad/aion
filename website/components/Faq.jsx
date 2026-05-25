const { useState: useStateFaq } = React;

const FAQ_ITEMS = [
  {
    q: "What does Aion actually do?",
    a: "It pulls your worklogs from Tempo, enriches them with Jira titles, applies leave routing from Paser, and writes the result into Dyce as time entries. Three commands, one source of truth."
  },
  {
    q: "Can I run it twice on the same day without creating duplicates?",
    a: "Yes — that's the point. Every successful write is recorded in a local sync log. On rerun, Aion skips anything already synced and only writes the delta."
  },
  {
    q: "Do I need to be on a specific stack?",
    a: "If you have Node 18 or newer, you're set. Install it globally with npm, run aion setup once, and you're done. macOS, Linux and Windows are supported."
  },
  {
    q: "How does the preview work?",
    a: "aion preview is a dry-run: it fetches, enriches, routes and renders the exact rows it would write — without touching Dyce. Read the diff, then decide to commit."
  },
  {
    q: "What happens to PTO and half-days?",
    a: "Leave hours coming from Paser are routed to a configurable project mapping, so your timesheets reflect real availability instead of being padded to fit."
  },
  {
    q: "Is my data going through a third-party service?",
    a: "No. Aion runs on your machine and talks directly to provider APIs with your own credentials. Nothing is proxied through us."
  },
];

const FaqItem = ({ item, open, onClick }) => (
  <div className={`faq-item ${open ? 'open' : ''}`} onClick={onClick}>
    <div className="faq-q">
      <span>{item.q}</span>
      <span className="plus" aria-hidden="true"></span>
    </div>
    <div className="faq-a">{item.a}</div>
  </div>
);

const Faq = () => {
  const [open, setOpen] = useStateFaq(0);
  return (
    <section id="faq" className="section">
      <div className="wrap faq-inner">
        <div>
          <span className="section-tag">03 · questions</span>
          <h2 className="section-title">Smaller print, <span className="italic">straight answers.</span></h2>
          <p className="section-sub" style={{ marginTop: 18 }}>
            The boring-but-important details. If something else is on your mind, the README and issue tracker live one click away.
          </p>
        </div>
        <div className="faq-list">
          {FAQ_ITEMS.map((item, i) => (
            <FaqItem key={i} item={item} open={open === i} onClick={() => setOpen(open === i ? -1 : i)} />
          ))}
        </div>
      </div>
    </section>
  );
};

window.Faq = Faq;
