import type { RoveDesktopApi } from "../preload/preload.js";

declare global {
  interface Window { rove: RoveDesktopApi; }
}

export {};
