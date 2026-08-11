import {
  StrictMode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

import type {
  CompanionSnapshot,
  DesktopNotice,
} from "../shared/desktop-api.js";
import {
  toCompanionViewModel,
  type CompanionExperience,
  type CompanionPrimaryAction,
} from "./state.js";
import roveMarkUrl from "./assets/rove-mark.svg";
import "./styles.css";

function App() {
  const [snapshot, setSnapshot] =
    useState<CompanionSnapshot | null>(null);

  const [notice, setNotice] =
    useState<DesktopNotice | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [busy, setBusy] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [detailsOpen, setDetailsOpen] =
    useState(false);

  const refresh = useCallback(async () => {
    try {
      const nextNotice =
        await window.rove.getNotice();

      setNotice(nextNotice);

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

    return () =>
      window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    setDetailsOpen(false);
  }, [snapshot?.session.id]);

  const run = async (
    operation: () =>
      Promise<CompanionSnapshot | null>,
  ) => {
    setBusy(true);

    try {
      setSnapshot(
        await operation(),
      );

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
    toCompanionViewModel(
      snapshot,
      notice,
    );

  const performPrimaryAction = (
    action: CompanionPrimaryAction,
  ) => {
    if (action === "take_control") {
      void run(
        window.rove.takeControl,
      );
      return;
    }

    if (action === "return_control") {
      void run(
        window.rove.returnControl,
      );
      return;
    }

    if (action === "finish_capture") {
      void run(
        window.rove.finishSession,
      );
    }
  };

  const connectionState =
    error === null
      ? "Connected"
      : "Offline";

  const quietAction =
    view.experience === "agent_working";

  const canEndFromDetails =
    view.hasSession &&
    view.canFinish &&
    view.experience !== "capture";

  return (
    <div
      className={[
        "app",
        `experience-${view.experience}`,
      ].join(" ")}
    >
      <header className="topbar">
        <div className="brand">
          <img
            className="brand-mark"
            src={roveMarkUrl}
            alt=""
            aria-hidden="true"
          />

          <div className="brand-copy">
            <strong>Rove</strong>
            <span>Companion</span>
          </div>
        </div>

        <div
          className={[
            "connection",
            error === null
              ? "connection-online"
              : "connection-offline",
          ].join(" ")}
          aria-label={connectionState}
          title={connectionState}
        >
          <span
            className="connection-dot"
            aria-hidden="true"
          />

          <span className="connection-label">
            {connectionState}
          </span>
        </div>
      </header>

      <main className="content">
        <section className="task-surface">
          <div
            className="state-indicator"
            aria-hidden="true"
          >
            <StateGlyph
              experience={view.experience}
            />
          </div>

          <p className="kicker">
            {loading
              ? "Connecting"
              : view.kicker}
          </p>

          <h1>
            {loading
              ? "Checking for a session…"
              : view.title}
          </h1>

          {!loading && (
            <>
              <p className="description">
                {view.description}
              </p>

              {view.supportingText !==
                undefined && (
                <p className="supporting">
                  {view.supportingText}
                </p>
              )}
            </>
          )}

          {error !== null && (
            <div
              className="error-message"
              role="alert"
            >
              <strong>
                Rove is offline
              </strong>
              <span>{error}</span>
            </div>
          )}

          {!loading &&
            view.primaryAction !== null &&
            view.primaryActionLabel !==
              undefined && (
              <button
                className={[
                  "primary-action",
                  quietAction
                    ? "primary-action-quiet"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={
                  busy ||
                  error !== null
                }
                onClick={() =>
                  performPrimaryAction(
                    view.primaryAction,
                  )
                }
              >
                {busy
                  ? "Working…"
                  : view.primaryActionLabel}
              </button>
            )}
        </section>

        {view.hasSession && (
          <section className="details">
            <button
              className="details-trigger"
              type="button"
              aria-expanded={detailsOpen}
              onClick={() =>
                setDetailsOpen(
                  (current) => !current,
                )
              }
            >
              <span>Details</span>

              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className={
                  detailsOpen
                    ? "chevron chevron-open"
                    : "chevron"
                }
              >
                <path
                  d="m5.75 7.75 4.25 4.25 4.25-4.25"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.7"
                />
              </svg>
            </button>

            <div
              className={[
                "details-collapse",
                detailsOpen
                  ? "details-collapse-open"
                  : "",
              ].join(" ")}
            >
              <div className="details-inner">
                <div className="metrics">
                  <div className="metric">
                    <strong>
                      {
                        view.observationCount
                      }
                    </strong>
                    <span>
                      Observations
                    </span>
                  </div>

                  <div className="metric">
                    <strong>
                      {view.evidenceCount}
                    </strong>
                    <span>Evidence</span>
                  </div>
                </div>

                <dl className="session-details">
                  <div>
                    <dt>Session</dt>
                    <dd
                      className="session-id"
                      title={view.sessionId}
                    >
                      {view.sessionId}
                    </dd>
                  </div>

                  <div>
                    <dt>Mode</dt>
                    <dd>{view.mode}</dd>
                  </div>

                  <div>
                    <dt>Controller</dt>
                    <dd>
                      {view.controller}
                    </dd>
                  </div>

                  <div>
                    <dt>Status</dt>
                    <dd>{view.status}</dd>
                  </div>
                </dl>

                {canEndFromDetails && (
                  <button
                    className="end-session"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        window.rove
                          .finishSession,
                      )
                    }
                  >
                    End session
                  </button>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function StateGlyph({
  experience,
}: {
  experience: CompanionExperience;
}) {
  if (experience === "handoff_waiting") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="state-glyph"
      >
        <path
          d="M5 8.5h9.5m0 0-3-3m3 3-3 3M19 15.5H9.5m0 0 3 3m-3-3 3-3"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (experience === "human_step") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="state-glyph"
      >
        <path
          d="m6.5 4.5 10 8-5.2 1.1-2.1 5.1-2.7-14.2Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </svg>
    );
  }

  if (experience === "capture") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="state-glyph"
      >
        <path
          d="M3.5 12s3.1-5 8.5-5 8.5 5 8.5 5-3.1 5-8.5 5-8.5-5-8.5-5Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <circle
          cx="12"
          cy="12"
          r="2.2"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (
    experience === "session_ended" ||
    experience === "interrupted"
  ) {
    return (
      <svg
        viewBox="0 0 24 24"
        className="state-glyph"
      >
        <path
          d="m7 12.5 3.2 3.2L17.5 8"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.9"
        />
      </svg>
    );
  }

  if (experience === "no_session") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="state-glyph"
      >
        <circle
          cx="12"
          cy="12"
          r="6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <circle
          cx="12"
          cy="12"
          r="1.6"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      className="state-glyph"
    >
      <circle
        cx="6"
        cy="17"
        r="1.7"
        fill="currentColor"
      />
      <circle
        cx="11.5"
        cy="8"
        r="1.7"
        fill="currentColor"
      />
      <path
        d="M7.4 15.9 10.3 10M13.2 8h4.7m0 0-2.3-2.3M17.9 8l-2.3 2.3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

createRoot(
  document.getElementById("root")!,
).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
