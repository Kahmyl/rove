export interface DesktopQuitDecision {
  preventQuit: boolean;
  startShutdown: boolean;
}

export class DesktopQuitBarrier {
  private state: "idle" | "stopping" | "ready" = "idle";

  request(hasManagedComponents: boolean): DesktopQuitDecision {
    if (this.state === "ready") {
      return { preventQuit: false, startShutdown: false };
    }
    if (!hasManagedComponents) {
      this.state = "ready";
      return { preventQuit: false, startShutdown: false };
    }
    if (this.state === "stopping") {
      return { preventQuit: true, startShutdown: false };
    }
    this.state = "stopping";
    return { preventQuit: true, startShutdown: true };
  }

  complete(): void {
    this.state = "ready";
  }
}
