import { useEffect, useState } from "react";
import type { CustomerStateMarker } from "../main/codex/customer-task-presentation.js";

export interface CustomerNotice extends CustomerStateMarker {
  owner: string;
  markerId?: string;
}

/** Dismissal is renderer memory, never an operation or durable receipt. */
export function retainActiveDismissals(
  dismissed: ReadonlySet<string>,
  active: readonly string[],
): Set<string> {
  const keys = new Set(active);
  return new Set([...dismissed].filter((key) => keys.has(key)));
}

export function CustomerStateMarkers({
  markers,
  id,
  owner,
}: {
  markers: readonly CustomerStateMarker[];
  id: string;
  owner: string;
}) {
  if (!markers.length) return null;
  return (
    <details className="customer-state-marker" id={id}>
      <summary aria-label={`${owner} state details`}>
        {markers.map((marker) => marker.title).join(" · ")} <span>Details</span>
      </summary>
      <div>
        {markers.map((marker) => (
          <section key={marker.key}>
            <strong>{marker.title}</strong>
            <p>{marker.description}</p>
          </section>
        ))}
      </div>
    </details>
  );
}

export function CustomerStateNotices({
  notices,
  activeKeys,
}: {
  notices: readonly CustomerNotice[];
  activeKeys: readonly string[];
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const activeIdentity = JSON.stringify(activeKeys);
  useEffect(() => {
    const active: string[] = JSON.parse(activeIdentity);
    setDismissed((previous) => {
      const next = retainActiveDismissals(previous, active);
      return next.size === previous.size ? previous : next;
    });
  }, [activeIdentity]);
  const visible = notices.filter((notice) => !dismissed.has(notice.key));
  if (!visible.length) return null;
  return (
    <aside className="customer-notifications" aria-label="Notifications">
      {visible.slice(0, 2).map((notice) => (
        <section className="customer-notification" key={notice.key}>
          <div role="status" aria-atomic="true">
            <small>{notice.owner}</small>
            <strong>{notice.title}</strong>
            <p>{notice.description}</p>
          </div>
          <button
            type="button"
            aria-label={`Dismiss ${notice.title} notification`}
            onClick={() => {
              setDismissed((previous) => new Set(previous).add(notice.key));
              // Return locally owned focus to the persistent marker, never behind a modal.
              if (!document.querySelector('[aria-modal="true"]'))
                document
                  .getElementById(notice.markerId ?? "")
                  ?.querySelector<HTMLElement>("summary")
                  ?.focus({ preventScroll: true });
            }}
          >
            Dismiss
          </button>
        </section>
      ))}
    </aside>
  );
}
