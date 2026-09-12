import { isAbsolute, join, normalize } from "node:path";

export const DESKTOP_HOME_DIRECTORY = "Rove";
export const DESKTOP_PRODUCT_DIRECTORY = "product";

export interface DesktopProductHomeOptions {
  appDataDirectory: string;
  qualificationOverride?: string;
}

/**
 * Resolves Desktop-owned persistent state independently from the repository,
 * launch cwd, and Electron's mutable Chromium user-data directory.
 */
export function resolveDesktopProductHome(
  options: DesktopProductHomeOptions,
): string {
  const override = options.qualificationOverride?.trim();
  if (override !== undefined && override.length > 0) {
    if (!isAbsolute(override)) {
      throw new Error("ROVE_DESKTOP_HOME must be an absolute path.");
    }
    return normalize(override);
  }
  return join(
    normalize(options.appDataDirectory),
    DESKTOP_HOME_DIRECTORY,
    DESKTOP_PRODUCT_DIRECTORY,
  );
}
