import { createHash, randomUUID } from "node:crypto";
import {
  generatedFileArtifactRequestSchema,
  localFileGrantRequestSchema,
  MAX_GRANTED_FILE_BYTES,
  type HubCommand,
  type HubCommandError,
  type LocalFileGrantRequest,
} from "@rove/protocol";

export interface LocalRuntimeConnection {
  baseUrl: string;
  token: string;
}

export interface LocalFileGrantSelection {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  attachmentId?: string;
  grantId?: string;
}

export interface HubCommandAuthority {
  requestLocalFileGrant?(
    request: LocalFileGrantRequest & { sessionId?: string },
  ): Promise<LocalFileGrantSelection[] | null>;
  completeLocalFileGrant?(
    sessionId: string,
    materialized: readonly { attachmentId: string; evidenceId: string }[],
  ): Promise<void>;
  failLocalFileGrant?(
    sessionId: string,
    attachmentIds: readonly string[],
  ): Promise<void>;
  markLocalFileGrantReconciliation?(
    sessionId: string,
    attachmentIds: readonly string[],
  ): Promise<void>;
}

export async function executeHubCommand(
  command: HubCommand,
  runtime: LocalRuntimeConnection,
  authority: HubCommandAuthority = {},
): Promise<unknown> {
  const payload = asRecord(command.payload);
  const sessionId = optionalString(payload.sessionId);
  const input = payload.input;

  switch (command.operation) {
    case "runtime.health":
      return runtimeRequest(runtime, "GET", "/health", undefined, 5_000);
    case "session.start":
      return runtimeRequest(runtime, "POST", "/sessions", command.payload);
    case "session.status":
      return runtimeRequest(runtime, "GET", sessionPath(sessionId));
    case "session.end":
      return runtimeRequest(runtime, "POST", `${sessionPath(sessionId)}/end`);
    case "session.observations": {
      const query = new URLSearchParams();
      const options = asRecord(input);
      if (options.afterSeq !== undefined)
        query.set("afterSeq", String(options.afterSeq));
      if (options.limit !== undefined)
        query.set("limit", String(options.limit));
      return runtimeRequest(
        runtime,
        "GET",
        `${sessionPath(sessionId)}/observations?${query.toString()}`,
      );
    }
    case "browser.navigate":
    case "browser.open_page":
    case "browser.resolve_target":
    case "browser.interact":
    case "browser.reconcile_outcome":
    case "browser.click":
    case "browser.type":
    case "browser.press":
    case "browser.scroll":
    case "browser.screenshot":
      return runtimeRequest(
        runtime,
        "POST",
        `${sessionPath(sessionId)}/browser/${
          command.operation === "browser.resolve_target"
            ? "resolve-target"
            : command.operation === "browser.interact"
              ? "interact"
              : command.operation === "browser.reconcile_outcome"
                ? "reconcile-outcome"
                : command.operation === "browser.open_page"
                  ? "pages"
                  : command.operation.split(".")[1]
        }`,
        input,
      );
    case "browser.pages":
      return runtimeRequest(
        runtime,
        "GET",
        `${sessionPath(sessionId)}/browser/pages`,
      );
    case "browser.switch_page":
      return runtimeRequest(
        runtime,
        "POST",
        `${sessionPath(sessionId)}/browser/pages/${encodeURIComponent(requiredString(payload.pageId, "pageId"))}/switch`,
      );
    case "browser.close_page":
      return runtimeRequest(
        runtime,
        "DELETE",
        `${sessionPath(sessionId)}/browser/pages/${encodeURIComponent(requiredString(payload.pageId, "pageId"))}`,
      );
    case "browser.inspect":
      return runtimeRequest(
        runtime,
        "POST",
        `${sessionPath(sessionId)}/browser/inspect`,
        input,
      );
    case "browser.transaction_begin":
      return runtimeRequest(
        runtime,
        "POST",
        `${sessionPath(sessionId)}/browser/transactions`,
        input,
      );
    case "browser.prepare_task_result_action":
      return runtimeRequest(
        runtime,
        "POST",
        `${sessionPath(sessionId)}/effects/prepare-task-result`,
        input,
      );
    case "browser.task_result_action_plan":
      return runtimeRequest(
        runtime,
        "GET",
        `${sessionPath(sessionId)}/effects/consequential?consequenceKey=${encodeURIComponent(requiredString(payload.consequenceKey, "consequenceKey"))}`,
      );
    case "browser.transaction_advance": {
      const transaction = asRecord(input);
      const transactionId = requiredString(
        transaction.transactionId,
        "input.transactionId",
      );
      const body = { ...transaction };
      delete body.transactionId;
      return runtimeRequest(
        runtime,
        "POST",
        `${sessionPath(sessionId)}/browser/transactions/${encodeURIComponent(transactionId)}/advance`,
        body,
      );
    }
    case "browser.transaction_verify": {
      const transaction = asRecord(input);
      const transactionId = requiredString(
        transaction.transactionId,
        "input.transactionId",
      );
      const body = { ...transaction };
      delete body.transactionId;
      return runtimeRequest(
        runtime,
        "POST",
        `${sessionPath(sessionId)}/browser/transactions/${encodeURIComponent(transactionId)}/verify`,
        body,
      );
    }
    case "browser.transaction_status":
      return runtimeRequest(
        runtime,
        "GET",
        `${sessionPath(sessionId)}/browser/transactions/${encodeURIComponent(requiredString(payload.transactionId, "transactionId"))}`,
      );
    case "browser.transaction_cancel":
      return runtimeRequest(
        runtime,
        "POST",
        `${sessionPath(sessionId)}/browser/transactions/${encodeURIComponent(requiredString(payload.transactionId, "transactionId"))}/cancel`,
      );
    case "browser.back":
    case "browser.forward":
      return runtimeRequest(
        runtime,
        "POST",
        `${sessionPath(sessionId)}/browser/${command.operation.split(".")[1]}`,
      );
    case "evidence.create_file": {
      const generated = generatedFileArtifactRequestSchema.parse(input);
      const bytes =
        generated.encoding === "base64"
          ? Buffer.from(generated.content, "base64")
          : Buffer.from(generated.content, "utf8");
      return runtimeFileRequest(runtime, sessionId, {
        filename: generated.filename,
        mimeType: generated.mimeType,
        source: "agent_generated",
        bytes,
      });
    }
    case "evidence.request_file_grant": {
      const grantRequest = localFileGrantRequestSchema.parse(input);
      if (authority.requestLocalFileGrant === undefined) {
        throw {
          code: "FILE_GRANT_UNAVAILABLE",
          message:
            "Rove Companion does not provide a local file grant surface.",
          retryable: false,
        } satisfies RuntimeFailure;
      }
      const selected = await authority.requestLocalFileGrant({
        ...grantRequest,
        sessionId: requiredString(payload.sessionId, "sessionId"),
      });
      if (selected === null || selected.length === 0) {
        return { status: "cancelled", evidence: [] };
      }
      if (selected.length > 100) {
        throw {
          code: "INVALID_CONFIGURATION",
          message: "A local file grant cannot contain more than 100 files.",
          retryable: false,
        } satisfies RuntimeFailure;
      }
      for (const file of selected) {
        if (file.bytes.byteLength > MAX_GRANTED_FILE_BYTES) {
          throw {
            code: "FILE_ARTIFACT_TOO_LARGE",
            message: "A selected file exceeds the 64 MiB grant limit.",
            retryable: false,
            details: { limitBytes: MAX_GRANTED_FILE_BYTES },
          } satisfies RuntimeFailure;
        }
      }
      const suppliedGrants = new Set(
        selected.flatMap((file) => (file.grantId ? [file.grantId] : [])),
      );
      if (suppliedGrants.size > 1)
        throw new Error("File selection contains conflicting grants.");
      const grantId =
        [...suppliedGrants][0] ?? `grant_${randomUUID().replaceAll("-", "")}`;
      const evidence: unknown[] = [];
      try {
        for (const file of selected) {
          const item = await runtimeFileRequest(runtime, sessionId, {
            ...file,
            source: "user_file_grant",
            grantId,
          });
          assertGrantedEvidence(item, sessionId!, grantId, file);
          evidence.push(item);
        }
      } catch (error) {
        try {
          await runtimeRequest(
            runtime,
            "DELETE",
            `${sessionPath(sessionId)}/evidence/files/grants/${encodeURIComponent(grantId)}`,
          );
          await authority.failLocalFileGrant?.(
            sessionId!,
            selected.flatMap((file) =>
              file.attachmentId ? [file.attachmentId] : [],
            ),
          );
        } catch {
          await authority
            .markLocalFileGrantReconciliation?.(
              sessionId!,
              selected.flatMap((file) =>
                file.attachmentId ? [file.attachmentId] : [],
              ),
            )
            .catch(() => undefined);
          throw {
            code: "RUNTIME_UNAVAILABLE",
            message: "File grant cleanup requires reconciliation.",
            retryable: true,
          } satisfies RuntimeFailure;
        }
        throw sanitizeHubError(error, "File grant materialization failed.");
      }
      const materialized = selected.flatMap((file, index) => {
        const item = evidence[index] as { id: string };
        return file.attachmentId
          ? [{ attachmentId: file.attachmentId, evidenceId: item.id }]
          : [];
      });
      if (
        materialized.length !==
        selected.filter((file) => file.attachmentId).length
      )
        throw new Error("File grant response cardinality mismatch.");
      if (materialized.length > 0)
        try {
          await authority.completeLocalFileGrant?.(sessionId!, materialized);
        } catch (error) {
          throw sanitizeHubError(
            error,
            "File grant completion requires reconciliation.",
          );
        }
      return { status: "selected", evidence };
    }
    case "evidence.save_record": {
      const recordInput = asRecord(input);
      return runtimeRequest(
        runtime,
        "POST",
        `${sessionPath(sessionId)}/evidence`,
        {
          type: "record",
          label: recordInput.label,
          payload: recordInput.record,
        },
      );
    }
    case "evidence.list":
      return runtimeRequest(
        runtime,
        "GET",
        `${sessionPath(sessionId)}/evidence`,
      );
    case "evidence.read":
      return runtimeRequest(
        runtime,
        "GET",
        `${sessionPath(sessionId)}/evidence/${encodeURIComponent(requiredString(payload.evidenceId, "evidenceId"))}`,
      );
    case "control.status":
      return runtimeRequest(
        runtime,
        "GET",
        `${sessionPath(sessionId)}/control`,
      );
    case "control.request_human":
      return runtimeRequest(
        runtime,
        "POST",
        `${sessionPath(sessionId)}/control/request-human`,
        {
          reason: requiredString(payload.reason, "reason"),
        },
      );
    case "control.wait": {
      const options = asRecord(input);
      const query = new URLSearchParams();
      if (options.afterSeq !== undefined)
        query.set("afterSeq", String(options.afterSeq));
      if (options.timeoutMs !== undefined)
        query.set("timeoutMs", String(options.timeoutMs));
      const timeoutMs =
        typeof options.timeoutMs === "number"
          ? options.timeoutMs + 5_000
          : 35_000;
      return runtimeRequest(
        runtime,
        "GET",
        `${sessionPath(sessionId)}/control/wait?${query.toString()}`,
        undefined,
        timeoutMs,
      );
    }
  }
}

async function runtimeFileRequest(
  runtime: LocalRuntimeConnection,
  sessionId: string | undefined,
  file: {
    filename: string;
    mimeType: string;
    source: "agent_generated" | "user_file_grant";
    bytes: Uint8Array;
    grantId?: string;
  },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(
      new URL(`${sessionPath(sessionId)}/evidence/files`, runtime.baseUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${runtime.token}`,
          "content-type": file.mimeType,
          "x-rove-file-name": Buffer.from(file.filename, "utf8").toString(
            "base64url",
          ),
          "x-rove-file-source": file.source,
          ...(file.grantId === undefined
            ? {}
            : { "x-rove-grant-id": file.grantId }),
        },
        body: Buffer.from(file.bytes),
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch (error) {
    throw {
      code:
        error instanceof DOMException && error.name === "TimeoutError"
          ? "RUNTIME_TIMEOUT"
          : "RUNTIME_UNAVAILABLE",
      message:
        error instanceof DOMException && error.name === "TimeoutError"
          ? "Runtime file-artifact request timed out."
          : "Local Runtime is unavailable.",
      retryable: true,
    } satisfies RuntimeFailure;
  }

  const text = await response.text();
  if (!response.ok) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const nested = asRecord(asRecord(parsed).error);
    throw {
      code:
        typeof nested.code === "string"
          ? nested.code
          : "RUNTIME_PROTOCOL_ERROR",
      message:
        typeof nested.message === "string"
          ? nested.message
          : `Runtime failed with HTTP ${response.status}.`,
      retryable: nested.retryable === true,
      ...(nested.details === undefined ? {} : { details: nested.details }),
    } satisfies RuntimeFailure;
  }
  return text.length === 0 ? undefined : (JSON.parse(text) as unknown);
}

function assertGrantedEvidence(
  value: unknown,
  sessionId: string,
  grantId: string,
  file: LocalFileGrantSelection,
): void {
  const item = asRecord(value);
  const metadata = asRecord(item.metadata);
  if (
    typeof item.id !== "string" ||
    !/^ev_[A-Za-z0-9_-]+$/.test(item.id) ||
    item.sessionId !== sessionId ||
    item.type !== "file" ||
    item.label !== file.filename ||
    metadata.filename !== file.filename ||
    metadata.mimeType !== file.mimeType ||
    metadata.sizeBytes !== file.bytes.byteLength ||
    metadata.sha256 !== createHash("sha256").update(file.bytes).digest("hex") ||
    metadata.source !== "user_file_grant" ||
    metadata.grantId !== grantId
  )
    throw {
      code: "RUNTIME_UNAVAILABLE",
      message: "Runtime returned invalid file evidence metadata.",
      retryable: true,
    } satisfies RuntimeFailure;
}

function sanitizeHubError(error: unknown, fallback: string): RuntimeFailure {
  const source =
    typeof error === "object" && error !== null
      ? String((error as { message?: unknown }).message ?? fallback)
      : fallback;
  const sanitized = source
    .replace(/\/[^\s]+/g, "[redacted-path]")
    .replace(/[A-Za-z]:\\[^\s]+/g, "[redacted-path]")
    .slice(0, 500);
  return {
    code: "RUNTIME_UNAVAILABLE",
    message: sanitized.includes("[redacted-path]") ? fallback : sanitized,
    retryable: true,
  };
}

export function toHubCommandError(error: unknown): HubCommandError {
  if (isRuntimeFailure(error)) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  return {
    code: "HUB_EXECUTION_FAILED",
    message:
      error instanceof Error ? error.message : "Hub command execution failed.",
    retryable: false,
  };
}

interface RuntimeFailure {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

export async function runtimeRequest(
  runtime: LocalRuntimeConnection,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(new URL(path, runtime.baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${runtime.token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw {
      code:
        error instanceof DOMException && error.name === "TimeoutError"
          ? "RUNTIME_TIMEOUT"
          : "RUNTIME_UNAVAILABLE",
      message:
        error instanceof DOMException && error.name === "TimeoutError"
          ? "Runtime request timed out."
          : "Local Runtime is unavailable.",
      retryable: true,
    } satisfies RuntimeFailure;
  }

  const text = await response.text();
  if (!response.ok) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const record = asRecord(parsed);
    const nested = asRecord(record.error);
    throw {
      code:
        typeof nested.code === "string"
          ? nested.code
          : "RUNTIME_PROTOCOL_ERROR",
      message:
        typeof nested.message === "string"
          ? nested.message
          : `Runtime failed with HTTP ${response.status}.`,
      retryable: nested.retryable === true,
      ...(nested.details === undefined ? {} : { details: nested.details }),
    } satisfies RuntimeFailure;
  }
  if (text.length === 0) return undefined;
  return JSON.parse(text) as unknown;
}

function sessionPath(sessionId: string | undefined): string {
  return `/sessions/${encodeURIComponent(requiredString(sessionId, "sessionId"))}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Hub command is missing ${name}.`);
  return value;
}

function isRuntimeFailure(value: unknown): value is RuntimeFailure {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.code === "string" &&
    typeof record.message === "string" &&
    typeof record.retryable === "boolean"
  );
}
