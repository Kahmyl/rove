import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { RoveError, type BrowserProfileConfig } from "@rove/protocol";

export interface RoveProfileMetadata {
  name: string;
  createdAt: string;
  lastUsedAt: string;
  browserDistribution: "chrome" | "chromium";
}

export interface ResolvedPersistentProfile {
  name: string;
  userDataDir: string;
  metadataPath: string;
  metadata: RoveProfileMetadata;
}

const SAFE_PROFILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export class RoveProfileManager {
  private readonly profilesRoot: string;

  constructor(private readonly home: string) {
    this.profilesRoot = resolve(home, "profiles");
  }

  async resolvePersistentProfile(
    profile: BrowserProfileConfig,
    browserDistribution: "chrome" | "chromium",
  ): Promise<ResolvedPersistentProfile | undefined> {
    if (profile.mode !== "persistent") return undefined;

    this.assertSafeProfileName(profile.name);

    const userDataDir = this.pathWithinProfilesRoot(profile.name);
    const metadataPath = resolve(userDataDir, "profile.json");

    await mkdir(userDataDir, { recursive: true });

    const now = new Date().toISOString();
    const existing = await this.readMetadata(metadataPath);
    const metadata: RoveProfileMetadata = {
      name: profile.name,
      createdAt: existing?.createdAt ?? now,
      lastUsedAt: now,
      browserDistribution,
    };

    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

    return {
      name: profile.name,
      userDataDir,
      metadataPath,
      metadata,
    };
  }

  private assertSafeProfileName(name: string): void {
    if (!SAFE_PROFILE_NAME.test(name)) {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Invalid persistent browser profile name.",
      });
    }
  }

  private pathWithinProfilesRoot(profileName: string): string {
    const target = resolve(this.profilesRoot, profileName);
    if (target !== this.profilesRoot && target.startsWith(`${this.profilesRoot}${sep}`)) {
      return target;
    }

    throw new RoveError({
      code: "INVALID_CONFIGURATION",
      message: "Persistent browser profile path escaped the Rove profiles directory.",
    });
  }

  private async readMetadata(
    metadataPath: string,
  ): Promise<RoveProfileMetadata | undefined> {
    try {
      const parsed = JSON.parse(await readFile(metadataPath, "utf8")) as Partial<RoveProfileMetadata>;

      if (
        typeof parsed.name !== "string" ||
        typeof parsed.createdAt !== "string" ||
        typeof parsed.lastUsedAt !== "string" ||
        (parsed.browserDistribution !== "chrome" &&
          parsed.browserDistribution !== "chromium")
      ) {
        return undefined;
      }

      return parsed as RoveProfileMetadata;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return undefined;
      }

      throw error;
    }
  }
}
