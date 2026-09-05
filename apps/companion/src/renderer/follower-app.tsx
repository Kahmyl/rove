import { useCallback, useEffect, useState } from "react";

import type { Session } from "@rove/protocol";

import type { FollowerPresentationMode } from "../shared/desktop-api.js";

import roveMarkUrl from "./assets/rove-mark.svg";

import {
  toCompactFollowerViewModel,
  type CompactFollowerPrimaryAction,
} from "./follower-state.js";

export function FollowerApp() {
  const [session, setSession] = useState<Session | null>(null);

  const [loading, setLoading] = useState(true);

  const [busy, setBusy] = useState(false);

  const [offline, setOffline] = useState(false);

  const [presentation, setPresentation] =
    useState<FollowerPresentationMode>("windowed_compact");

  const refresh = useCallback(async () => {
    try {
      const [nextSession, nextPresentation] = await Promise.all([
        window.rove.getLiveSession(),
        window.rove.getFollowerPresentation(),
      ]);

      setSession(nextSession);
      setPresentation(nextPresentation);

      setOffline(false);
    } catch {
      setSession(null);

      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const timer = window.setInterval(() => void refresh(), 500);

    return () => window.clearInterval(timer);
  }, [refresh]);

  const view = toCompactFollowerViewModel(session);

  const expanded = presentation.endsWith("_expanded");

  const fullscreenMicro = presentation === "fullscreen_micro";

  const runPrimary = async (action: CompactFollowerPrimaryAction) => {
    if (action === null) {
      return;
    }

    setBusy(true);

    try {
      if (action === "take_control") {
        await window.rove.takeControl();
      } else {
        await window.rove.returnControl();
      }

      await refresh();
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };

  const openRove = async () => {
    try {
      await window.rove.openRove();
    } catch {
      setOffline(true);
    }
  };

  const setExpansion = async (next: boolean) => {
    try {
      setPresentation(await window.rove.setFollowerExpanded(next));
    } catch {
      setOffline(true);
    }
  };

  if (fullscreenMicro) {
    return (
      <button
        className={`follower-micro follower-${view.experience}`}
        type="button"
        aria-label={`Expand Rove controls. ${view.kicker}: ${view.title}`}
        title="Expand Rove controls"
        onClick={() => void setExpansion(true)}
      >
        <img src={roveMarkUrl} alt="" aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
    );
  }

  const runSecondary = async (action: "pause" | "stop") => {
    setBusy(true);
    try {
      if (action === "pause") await window.rove.pauseSession();
      else await window.rove.finishSession();
      await refresh();
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={[
        "follower-app",
        presentation,
        expanded ? "follower-expanded" : "follower-collapsed",
        `follower-${view.experience}`,
      ].join(" ")}
    >
      <div className="follower-status">
        <img
          className="follower-mark"
          src={roveMarkUrl}
          alt=""
          aria-hidden="true"
        />

        <div className="follower-copy">
          <span className="follower-kicker">
            {offline ? "Offline" : loading ? "Connecting" : view.kicker}
          </span>

          <strong>{loading ? "Finding Rove…" : view.title}</strong>
          {expanded && (
            <span className="follower-description">{view.description}</span>
          )}
        </div>
      </div>

      <div className="follower-actions">
        {!loading &&
          !offline &&
          view.primaryAction !== null &&
          view.primaryActionLabel !== undefined && (
            <button
              className="follower-primary"
              type="button"
              disabled={busy}
              onClick={() => void runPrimary(view.primaryAction)}
            >
              {busy ? "Working…" : view.primaryActionLabel}
            </button>
          )}

        <button
          className="follower-open"
          type="button"
          onClick={() => void openRove()}
        >
          Open Rove
        </button>

        {expanded && view.canPause && (
          <button
            className="follower-secondary"
            type="button"
            disabled={busy}
            onClick={() => void runSecondary("pause")}
          >
            Pause
          </button>
        )}

        {expanded && view.canStop && (
          <button
            className="follower-danger"
            type="button"
            disabled={busy}
            onClick={() => void runSecondary("stop")}
          >
            Stop
          </button>
        )}

        <button
          className="follower-expand"
          type="button"
          aria-expanded={expanded}
          onClick={() => void setExpansion(!expanded)}
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
    </div>
  );
}
