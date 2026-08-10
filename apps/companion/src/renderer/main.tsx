import {
  StrictMode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

import type { CompanionSnapshot } from "../shared/desktop-api.js";
import { toCompanionViewModel } from "./state.js";
import "./styles.css";

function App() {
  const [snapshot, setSnapshot] =
    useState<CompanionSnapshot | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] =
    useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next =
        await window.rove.getSnapshot();

      setSnapshot(next);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to reach the Rove runtime.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const timer = window.setInterval(
      () => void refresh(),
      1_000,
    );

    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (
    operation: () => Promise<CompanionSnapshot | null>,
  ) => {
    setBusy(true);

    try {
      setSnapshot(await operation());
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The Rove operation failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const view =
    toCompanionViewModel(snapshot);

  return (
    <main className="shell">
      <header>
        <span className="mark">R</span>
        <h1>Rove</h1>
        <span className="status">
          {error === null ? "Local" : "Offline"}
        </span>
      </header>

      {view.handoffReason !== undefined && (
        <section className="handoff">
          <p className="eyebrow">
            Agent needs your help
          </p>
          <strong>{view.handoffReason}</strong>
          <button
            disabled={
              busy || !view.canTakeControl
            }
            onClick={() =>
              void run(
                window.rove.takeControl,
              )
            }
          >
            Take Control
          </button>
        </section>
      )}

      <section className="card">
        <p className="eyebrow">
          Current session
        </p>

        <dl>
          <div>
            <dt>Session</dt>
            <dd className="session-id">
              {loading
                ? "Loading…"
                : view.sessionId}
            </dd>
          </div>

          <div>
            <dt>Mode</dt>
            <dd>{view.mode}</dd>
          </div>

          <div>
            <dt>Controller</dt>
            <dd>{view.controller}</dd>
          </div>

          <div>
            <dt>Status</dt>
            <dd>{view.status}</dd>
          </div>
        </dl>

        {view.canReturnControl ? (
          <button
            disabled={busy}
            onClick={() =>
              void run(
                window.rove.returnControl,
              )
            }
          >
            Return Control
          </button>
        ) : (
          <button
            disabled={
              busy || !view.canTakeControl
            }
            onClick={() =>
              void run(
                window.rove.takeControl,
              )
            }
          >
            Take Control
          </button>
        )}
      </section>

      <section className="metrics">
        <div>
          <strong>
            {view.observationCount}
          </strong>
          <span>Observations</span>
        </div>

        <div>
          <strong>
            {view.evidenceCount}
          </strong>
          <span>Evidence</span>
        </div>
      </section>

      {error !== null && (
        <p className="error">{error}</p>
      )}

      <button
        className="secondary"
        disabled={busy || !view.canFinish}
        onClick={() =>
          void run(
            window.rove.finishSession,
          )
        }
      >
        Finish Session
      </button>
    </main>
  );
}

createRoot(
  document.getElementById("root")!,
).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
