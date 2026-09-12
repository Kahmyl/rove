import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { DesktopSurfaceSnapshot } from "../shared/desktop-api.js";
import { ProductSurface } from "./product-surface.js";
import { newestDesktopSnapshot } from "./product-surface-state.js";
import "./styles.css";

function RoveSurfaceRoot() {
  const [desktop, setDesktop] = useState<DesktopSurfaceSnapshot | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const snapshot = await window.rove.getSurfaceSnapshot();
      setDesktop((current) => newestDesktopSnapshot(current, snapshot));
      setConnectionError(null);
    } catch (cause) {
      setConnectionError(
        cause instanceof Error
          ? cause.message
          : "Unable to reach the local Rove host.",
      );
    }
  }, []);

  useEffect(() => {
    const unsubscribe = window.rove.subscribeSurfaceSnapshot((snapshot) => {
      setDesktop((current) => newestDesktopSnapshot(current, snapshot));
      setConnectionError(null);
    });
    void refresh();
    return unsubscribe;
  }, [refresh]);

  const follower =
    new URLSearchParams(window.location.search).get("surface") === "follower";

  return (
    <ProductSurface
      desktop={desktop}
      connectionError={connectionError}
      follower={follower}
      refresh={refresh}
    />
  );
}

const surfaceMode = new URLSearchParams(window.location.search).get("surface");
if (surfaceMode === "follower")
  document.documentElement.dataset.roveSurface = "follower";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RoveSurfaceRoot />
  </StrictMode>,
);
