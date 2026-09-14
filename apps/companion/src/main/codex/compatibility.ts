import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { arch, platform } from "node:process";

import approvedComponentsJson from "./approved-components.json" with { type: "json" };
import { CODEX_SCHEMA_SHA256 } from "./protocol.js";

export interface CodexCompatibilityBaseline {
  id: string;
  cliVersion: string;
  platformOs: "macos" | "linux" | "windows";
  architecture: string;
  executableSha256: string;
  executableBytes?: number;
  codeModeHostFilename: string;
  codeModeHostSha256: string;
  codeModeHostBytes: number;
  generatedSchemaSha256: string;
}

type ApprovedManifest = typeof approvedComponentsJson;
const approvedManifest: ApprovedManifest = approvedComponentsJson;

export function approvedCodexBaseline(
  source: "development" | "packaged",
): CodexCompatibilityBaseline {
  const purpose = source === "development" ? "development" : "packaging";
  const id = approvedManifest.selections[purpose];
  const component = approvedManifest.components.find(
    (entry) => entry.id === id,
  );
  if (!component)
    throw new Error(`Approved Codex ${purpose} selection ${id} is missing.`);
  return {
    id: component.id,
    cliVersion: component.cliVersion,
    platformOs: component.platformOs as "macos" | "linux" | "windows",
    architecture: component.architecture,
    executableSha256: component.executable.sha256,
    ...(component.executable.bytes === undefined
      ? {}
      : { executableBytes: component.executable.bytes }),
    codeModeHostFilename: component.codeModeHost.filename,
    codeModeHostSha256: component.codeModeHost.sha256,
    codeModeHostBytes: component.codeModeHost.bytes,
    generatedSchemaSha256: component.schema.aggregateSha256,
  };
}

export const REVIEWED_CODEX_BASELINES: readonly CodexCompatibilityBaseline[] = [
  approvedCodexBaseline("development"),
];
export const APPROVED_CODEX_CLI_VERSION =
  approvedCodexBaseline("development").cliVersion;

export type CodexResolutionFailure =
  | "unresolved_executable"
  | "unsupported_platform"
  | "unsupported_version"
  | "executable_digest_mismatch"
  | "component_set_mismatch"
  | "schema_digest_mismatch";

export class CodexCompatibilityError extends Error {
  constructor(
    readonly code: CodexResolutionFailure,
    message: string,
  ) {
    super(message);
  }
}

export interface ResolvedCodexExecutable {
  executablePath: string;
  codeModeHostPath: string;
  baseline: CodexCompatibilityBaseline;
  source: "development" | "packaged";
}

export interface CodexExecutableResolverOptions {
  isPackaged: boolean;
  packagedExecutablePath?: string;
  developmentExecutablePath?: string;
  developmentCodeModeHostPath?: string;
  schemaSha256?: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  readVersion?: (path: string) => Promise<string>;
  hashFile?: (path: string) => Promise<string>;
  fileSize?: (path: string) => Promise<number>;
}

function osName(value: NodeJS.Platform): "macos" | "linux" | "windows" {
  if (value === "darwin") return "macos";
  if (value === "linux") return "linux";
  if (value === "win32") return "windows";
  throw new CodexCompatibilityError(
    "unsupported_platform",
    `Codex App Server is not qualified on ${value}.`,
  );
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export class CodexExecutableResolver {
  constructor(private readonly options: CodexExecutableResolverOptions) {}

  async resolve(): Promise<ResolvedCodexExecutable> {
    const source = this.options.isPackaged ? "packaged" : "development";
    const executablePath = this.options.isPackaged
      ? this.options.packagedExecutablePath
      : this.options.developmentExecutablePath;
    if (executablePath === undefined || executablePath.trim().length === 0) {
      throw new CodexCompatibilityError(
        "unresolved_executable",
        source === "development"
          ? "The approved Rove-managed Codex component is not installed. Run `pnpm codex:component:install -- --source <qualified-codex-path>`, then retry."
          : "The approved Codex component is missing from packaged resources.",
      );
    }
    await access(executablePath, constants.X_OK).catch(() => {
      throw new CodexCompatibilityError(
        "unresolved_executable",
        source === "development"
          ? `The approved Rove-managed Codex component is missing or unreadable at ${executablePath}. Run \`pnpm codex:component:install -- --source <qualified-codex-path>\`, then retry.`
          : `Packaged Codex executable is missing or unreadable: ${executablePath}`,
      );
    });
    const targetOs = osName(this.options.platform ?? platform);
    const targetArch = this.options.architecture ?? arch;
    const schemaSha256 = this.options.schemaSha256 ?? CODEX_SCHEMA_SHA256;
    const baseline = approvedCodexBaseline(source);
    if (
      baseline.platformOs !== targetOs ||
      baseline.architecture !== targetArch
    ) {
      throw new CodexCompatibilityError(
        "unsupported_platform",
        `No reviewed Codex baseline exists for ${targetOs}/${targetArch}.`,
      );
    }
    if (baseline.generatedSchemaSha256 !== schemaSha256) {
      throw new CodexCompatibilityError(
        "schema_digest_mismatch",
        "Compiled Codex protocol schema is not a reviewed baseline.",
      );
    }
    const version = await this.options.readVersion?.(executablePath);
    if (version === undefined) {
      throw new CodexCompatibilityError(
        "unsupported_version",
        "A trusted Codex version probe is required.",
      );
    }
    if (baseline.cliVersion !== version) {
      throw new CodexCompatibilityError(
        "unsupported_version",
        `Codex ${version} is not a reviewed baseline.`,
      );
    }
    const digest = await (this.options.hashFile ?? sha256)(executablePath);
    if (baseline.executableSha256 !== digest) {
      throw new CodexCompatibilityError(
        "executable_digest_mismatch",
        "Codex executable digest does not match its reviewed baseline.",
      );
    }
    const codeModeHostPath = this.options.isPackaged
      ? join(dirname(executablePath), baseline.codeModeHostFilename)
      : (this.options.developmentCodeModeHostPath ??
        join(dirname(executablePath), baseline.codeModeHostFilename));
    await access(codeModeHostPath, constants.X_OK).catch(() => {
      throw new CodexCompatibilityError(
        "component_set_mismatch",
        `Approved Codex code-mode host is missing or not executable: ${codeModeHostPath}`,
      );
    });
    const helperDigest = await (this.options.hashFile ?? sha256)(
      codeModeHostPath,
    );
    const helperBytes = await (
      this.options.fileSize ?? (async (path) => (await stat(path)).size)
    )(codeModeHostPath);
    if (
      helperDigest !== baseline.codeModeHostSha256 ||
      helperBytes !== baseline.codeModeHostBytes
    ) {
      throw new CodexCompatibilityError(
        "component_set_mismatch",
        "Codex code-mode host identity does not match the approved component set.",
      );
    }
    return { executablePath, codeModeHostPath, baseline, source };
  }
}
