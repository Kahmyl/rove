import type { RoveDesktopApi } from "../shared/desktop-api.js";

declare global {
  interface Window {
    rove: RoveDesktopApi;
  }
}

export {};
