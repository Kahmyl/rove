import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SessionSnapshot } from "@rove/protocol";
import "./styles.css";

function App() {
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  useEffect(() => { void window.rove.getSession().then(setSession); }, []);

  const controller = session?.controller === "human" ? "You" : (session?.controller ?? "None");
  return (
    <main className="shell">
      <header><span className="mark">R</span><h1>Rove</h1><span className="status">Local</span></header>
      <section className="card">
        <p className="eyebrow">Current session</p>
        <dl>
          <div><dt>Status</dt><dd>{session?.status ?? "No session"}</dd></div>
          <div><dt>Mode</dt><dd>{session?.mode ?? "—"}</dd></div>
          <div><dt>Controller</dt><dd>{controller}</dd></div>
        </dl>
        {session?.controller === "human" ? (
          <button onClick={() => void window.rove.returnControl()}>Return control</button>
        ) : (
          <button disabled={!session} onClick={() => void window.rove.takeControl()}>Take control</button>
        )}
      </section>
      <section className="metrics">
        <div><strong>0</strong><span>Observations</span></div>
        <div><strong>0</strong><span>Evidence</span></div>
      </section>
      <button className="secondary" disabled={!session} onClick={() => void window.rove.finishSession()}>
        Finish session
      </button>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
