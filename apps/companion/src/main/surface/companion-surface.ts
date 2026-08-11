export interface PreventableCloseEvent {
  preventDefault(): void;
}

export interface CompanionWindowHandle {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  reload(): void;
  show(): void;
  hide(): void;
  focus(): void;
  on(event: "close", listener: (event: PreventableCloseEvent) => void): void;
  once(event: "closed", listener: () => void): void;
}

export type CompanionWindowFactory = () => CompanionWindowHandle;

export class CompanionSurface {
  private window: CompanionWindowHandle | undefined;

  constructor(
    private readonly createWindow: CompanionWindowFactory,
    private readonly shouldAllowClose: () => boolean,
  ) {}

  ensure(): CompanionWindowHandle {
    if (this.window !== undefined && !this.window.isDestroyed()) {
      return this.window;
    }

    const window = this.createWindow();

    this.window = window;

    window.on("close", (event) => {
      if (this.shouldAllowClose()) {
        return;
      }

      event.preventDefault();
      window.hide();
    });

    window.once("closed", () => {
      if (this.window === window) {
        this.window = undefined;
      }
    });

    return window;
  }

  show(): void {
    const window = this.ensure();

    if (window.isMinimized()) {
      window.restore();
    }

    window.show();
    window.focus();
  }

  hide(): void {
    const window = this.window;

    if (window === undefined || window.isDestroyed()) {
      return;
    }

    window.hide();
  }

  restore(): void {
    this.show();
  }

  recover(): void {
    const window = this.ensure();

    window.reload();
    this.show();
  }

  requestAttention(): void {
    this.show();
  }
}
