import { useEffect, useRef, useState, type ReactNode } from "react";

export type SecondaryDisclosure = "navigation" | "inspector" | null;

/** Allocation is presentation only, independent of stored preferences and Task authority. */
export function resolveShellComposition(
  width: number,
  navigationCollapsed: boolean,
  hasInspector: boolean,
) {
  const navigation = width >= 968 && !navigationCollapsed;
  // 240px navigation + 280px inspector + 48px gutters leave at least 680px of work.
  const inspector =
    hasInspector &&
    width >= 1280 &&
    width - (navigation ? 240 : 0) - 280 >= 728;
  return {
    navigation,
    inspector,
    mode: width < 968 ? "compact" : inspector ? "wide" : "standard",
  } as const;
}

export function useShellViewport() {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 1180 : window.innerWidth,
  );
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    resize();
    return () => window.removeEventListener("resize", resize);
  }, []);
  return width;
}

function visible(node: HTMLElement) {
  const closedDetails = node.closest("details:not([open])");
  if (closedDetails && node !== closedDetails.querySelector(":scope > summary"))
    return false;
  return (
    node.isConnected &&
    node.getClientRects().length > 0 &&
    getComputedStyle(node).visibility !== "hidden" &&
    !node.closest("[hidden], [inert]")
  );
}

// Nested surfaces can protect the same ancestor. Cleanup releases only its own lease,
// including when the underlying drawer closes or becomes inline beneath a live dialog.
const inertLeases = new WeakMap<
  HTMLElement,
  { count: number; initial: boolean }
>();

function acquireInert(node: HTMLElement) {
  const lease = inertLeases.get(node) ?? { count: 0, initial: node.inert };
  lease.count += 1;
  inertLeases.set(node, lease);
  node.inert = true;
  return () => {
    lease.count -= 1;
    if (lease.count === 0) {
      node.inert = lease.initial;
      inertLeases.delete(node);
    }
  };
}

/** Trap the topmost overlay and restore focus without moving the conversation's scroll. */
export function useSurfaceFocus(
  active: boolean | string | null,
  resolveSurface: () => HTMLElement | null,
) {
  const resolve = useRef(resolveSurface);
  resolve.current = resolveSurface;
  useEffect(() => {
    const node = active ? resolve.current() : null;
    if (!node) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const background: HTMLElement[] = [];
    // Inert siblings along the ancestor path, never an ancestor of the dialog itself.
    for (
      let current: HTMLElement = node;
      current.parentElement;
      current = current.parentElement
    ) {
      background.push(
        ...Array.from(current.parentElement.children).filter(
          (entry): entry is HTMLElement =>
            entry instanceof HTMLElement &&
            entry !== current &&
            !(
              current === node &&
              entry.classList.contains("shell-drawer-backdrop")
            ),
        ),
      );
      if (current.parentElement.classList.contains("product-app")) break;
    }
    const releaseBackground = background.map(acquireInert);
    const focusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
        ),
      ).filter(visible);
    (focusable()[0] ?? node).focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const entries = focusable();
      const first = entries[0] ?? node;
      const last = entries.at(-1) ?? node;
      if (
        entries.length === 0 ||
        (event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === node)) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      }
    };
    node.addEventListener("keydown", keydown);
    return () => {
      node.removeEventListener("keydown", keydown);
      releaseBackground.forEach((release) => release());
      const target =
        previous && visible(previous)
          ? previous
          : document.querySelector<HTMLElement>(".sidebar-toggle");
      if (target && visible(target)) target.focus({ preventScroll: true });
    };
  }, [active]);
}

/** Keep secondary content mounted while changing its presentation. */
export function ShellSecondarySurface({
  name,
  label,
  className,
  inline,
  open,
  suspended,
  onClose,
  onDismissMenu,
  children,
}: {
  name: Exclude<SecondaryDisclosure, null>;
  label: string;
  className: string;
  inline: boolean;
  open: boolean;
  suspended: boolean;
  onClose(): void;
  onDismissMenu?(): boolean;
  children: ReactNode;
}) {
  const surface = useRef<HTMLElement>(null);
  const modal = !inline && open;
  useSurfaceFocus(modal, () => surface.current);
  return (
    <>
      {modal && (
        <div
          className="shell-drawer-backdrop"
          aria-hidden="true"
          onClick={onClose}
        />
      )}
      <aside
        ref={surface}
        className={className}
        aria-label={label}
        tabIndex={0}
        id={`shell-${name}`}
        hidden={!inline && !open}
        data-shell-drawer={!inline ? name : undefined}
        role={modal ? "dialog" : undefined}
        aria-modal={modal && !suspended ? true : undefined}
        onKeyDown={(event) => {
          if (
            !modal ||
            suspended ||
            event.key !== "Escape" ||
            event.defaultPrevented
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          const menu = surface.current?.querySelector<HTMLDetailsElement>(
            ".profile-actions[open], .app-menu[open], .task-more-menu[open]",
          );
          if (menu) {
            menu.open = false;
            menu.querySelector<HTMLElement>("summary")?.focus();
          } else if (!onDismissMenu?.()) onClose();
        }}
      >
        {modal && (
          <header className="shell-drawer-heading">
            <strong>
              {name === "navigation" ? "Navigation" : "Task details"}
            </strong>
            <button
              type="button"
              aria-label={`Close ${name}`}
              onClick={onClose}
            >
              ×
            </button>
          </header>
        )}
        {children}
      </aside>
    </>
  );
}
