import { useRef, useState, type PointerEvent } from "react";

import type {
  DesktopSurfaceSnapshot,
  FollowerPresentationMode,
} from "../shared/desktop-api.js";

import roveMarkUrl from "./assets/rove-mark.png";

import {
  toCompactFollowerViewModel,
  type CompactFollowerPrimaryAction,
} from "./follower-state.js";

export interface FollowerAppProps {
  desktop: DesktopSurfaceSnapshot | null;
  connectionError: string | null;
  refresh(): Promise<void>;
}

function followerPresentation(
  desktop: DesktopSurfaceSnapshot | null,
): FollowerPresentationMode {
  const expanded = desktop?.surface.presentation === "expanded";
  const fullscreen = desktop?.surface.browserContext === "fullscreen";
  if (fullscreen) return expanded ? "fullscreen_expanded" : "fullscreen_micro";
  return expanded ? "windowed_expanded" : "windowed_compact";
}

export function FollowerApp({
  desktop,
  connectionError,
  refresh,
}: FollowerAppProps) {
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  const session =
    desktop?.notice === null ? (desktop.companion?.session ?? null) : null;
  const loading = desktop === null;
  const offline = connectionError !== null || operationError !== null;
  const presentation = followerPresentation(desktop);

  const dragPointer = useRef<number | null>(null);

  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("button") !== null) return;

    dragPointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    void window.rove.beginFollowerDrag();
  };

  const updateDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragPointer.current !== event.pointerId) return;
    void window.rove.updateFollowerDrag();
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragPointer.current !== event.pointerId) return;

    dragPointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    void window.rove.endFollowerDrag();
  };

  const cancelDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragPointer.current === event.pointerId) dragPointer.current = null;
  };

  const view = toCompactFollowerViewModel(session);

  const expanded = presentation.endsWith("_expanded");

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
      setOperationError(null);
    } catch (cause) {
      setOperationError(
        cause instanceof Error ? cause.message : "The Rove operation failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const openRove = async () => {
    try {
      await window.rove.openRove();
      await refresh();
      setOperationError(null);
    } catch (cause) {
      setOperationError(
        cause instanceof Error ? cause.message : "The Rove operation failed.",
      );
    }
  };

  const setExpansion = async (next: boolean) => {
    try {
      await window.rove.transitionSurface(next ? "expand" : "collapse");
      await refresh();
      setOperationError(null);
    } catch (cause) {
      setOperationError(
        cause instanceof Error ? cause.message : "The Rove operation failed.",
      );
    }
  };

  if (!expanded) {
    return (
      <div
        className={`follower-micro follower-${view.experience}`}
        title="Drag Rove"
        onPointerDown={beginDrag}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
      >
        <img src={roveMarkUrl} alt="" aria-hidden="true" />
        <span className="follower-state-dot" aria-hidden="true" />
        <button
          className="follower-micro-expand"
          type="button"
          aria-label={`Expand Rove controls. ${view.kicker}: ${view.title}`}
          title="Expand Rove controls"
          onClick={() => void setExpansion(true)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6.25 3.25h-3v3M9.75 3.25h3v3M6.25 12.75h-3v-3M9.75 12.75h3v-3" />
          </svg>
        </button>
      </div>
    );
  }

  const runSecondary = async (action: "pause" | "stop") => {
    setBusy(true);
    try {
      if (action === "pause") await window.rove.pauseSession();
      else await window.rove.finishSession();
      await refresh();
      setOperationError(null);
    } catch (cause) {
      setOperationError(
        cause instanceof Error ? cause.message : "The Rove operation failed.",
      );
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
      onPointerDown={beginDrag}
      onPointerMove={updateDrag}
      onPointerUp={endDrag}
      onPointerCancel={cancelDrag}
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
