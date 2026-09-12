import type {
  UnifiedSurfaceBrowserContext,
  UnifiedSurfaceHostKind,
  UnifiedSurfacePresentation,
  UnifiedSurfaceState,
} from "../../shared/desktop-api.js";

export type {
  UnifiedSurfaceBrowserContext,
  UnifiedSurfaceHostKind,
  UnifiedSurfacePresentation,
  UnifiedSurfaceState,
} from "../../shared/desktop-api.js";

export type UnifiedSurfaceSnapshot = UnifiedSurfaceState;

export type UnifiedSurfaceEvent =
  | { type: "expand" }
  | { type: "collapse" }
  | { type: "open_full" }
  | { type: "close_full" }
  | { type: "browser_context"; context: UnifiedSurfaceBrowserContext };

function hostFor(
  presentation: UnifiedSurfacePresentation,
): UnifiedSurfaceHostKind {
  return presentation === "full" ? "control_center" : "browser_follower";
}

/**
 * One logical surface state, independent of the native window used to host it.
 */
export class UnifiedSurfaceStateMachine {
  private state: UnifiedSurfaceSnapshot = {
    presentation: "chip",
    browserContext: "windowed",
    activeHost: "browser_follower",
    returnPresentation: "chip",
    revision: 0,
  };

  snapshot(): UnifiedSurfaceSnapshot {
    return { ...this.state };
  }

  dispatch(event: UnifiedSurfaceEvent): UnifiedSurfaceSnapshot {
    const previous = this.state;
    let presentation = previous.presentation;
    let returnPresentation = previous.returnPresentation;
    let browserContext = previous.browserContext;

    switch (event.type) {
      case "expand":
        if (presentation !== "full") presentation = "expanded";
        returnPresentation = "expanded";
        break;
      case "collapse":
        if (presentation !== "full") presentation = "chip";
        returnPresentation = "chip";
        break;
      case "open_full":
        if (presentation !== "full") {
          returnPresentation = presentation;
          presentation = "full";
        }
        break;
      case "close_full":
        if (presentation === "full") presentation = returnPresentation;
        break;
      case "browser_context":
        browserContext = event.context;
        break;
    }

    if (
      presentation === previous.presentation &&
      returnPresentation === previous.returnPresentation &&
      browserContext === previous.browserContext
    ) {
      return this.snapshot();
    }

    this.state = {
      presentation,
      returnPresentation,
      browserContext,
      activeHost: hostFor(presentation),
      revision: previous.revision + 1,
    };
    return this.snapshot();
  }
}

export interface UnifiedSurfaceHost {
  isVisible(): boolean;
  hide(): void;
  show(snapshot: UnifiedSurfaceSnapshot): void;
}

/**
 * Transfers one logical surface between native hosts. The inactive host is
 * hidden before the active host is presented, preventing duplicate products
 * from appearing even when two OS-level windows remain necessary.
 */
export class UnifiedSurfaceCoordinator {
  constructor(
    private readonly follower: UnifiedSurfaceHost,
    private readonly controlCenter: UnifiedSurfaceHost,
  ) {}

  present(snapshot: UnifiedSurfaceSnapshot): void {
    const active =
      snapshot.activeHost === "control_center"
        ? this.controlCenter
        : this.follower;
    const inactive =
      active === this.follower ? this.controlCenter : this.follower;

    inactive.hide();
    active.show(snapshot);
  }

  visibleHostCount(): number {
    return (
      Number(this.follower.isVisible()) + Number(this.controlCenter.isVisible())
    );
  }
}
