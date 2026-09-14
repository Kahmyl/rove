export interface DesktopRelaunchOperations {
  relaunch(): void;
  quit(): void;
}

/**
 * Schedules exactly one application relaunch, then enters Electron's normal
 * quit path. The existing before-quit barrier remains responsible for stopping
 * managed Rove components before Electron exits.
 */
export function createDesktopRelaunchRequest(
  operations: DesktopRelaunchOperations,
): () => boolean {
  let requested = false;

  return () => {
    if (requested) return false;
    requested = true;
    operations.relaunch();
    operations.quit();
    return true;
  };
}
