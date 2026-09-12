import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";
import { clearTimeout, setTimeout } from "node:timers";
import {
  CodexAppServerHost,
  CodexExecutableResolver,
  readCodexVersion,
} from "../../apps/companion/dist/main/main/codex/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const executable =
  process.env.ROVE_CODEX_EXECUTABLE ??
  "/Applications/ChatGPT.app/Contents/Resources/codex";
const useExistingAuth = process.env.ROVE_LIFECYCLE_USE_EXISTING_AUTH === "1";
const isolatedAuthFile = process.env.ROVE_LIFECYCLE_AUTH_FILE;
const historyMode = process.env.ROVE_LIFECYCLE_HISTORY_MODE;
const restartBeforeRecovery =
  process.env.ROVE_LIFECYCLE_RESTART_BEFORE_RECOVERY === "1";
const lifecycleCwd = process.env.ROVE_LIFECYCLE_CWD;
const lifecycleSandbox = process.env.ROVE_LIFECYCLE_SANDBOX;
const lifecyclePermissions = process.env.ROVE_LIFECYCLE_PERMISSIONS;
const lifecycleConfig = process.env.ROVE_LIFECYCLE_CONFIG_CONTENT;
const lifecyclePrompt = process.env.ROVE_LIFECYCLE_PROMPT;
const lifecycleTurnTimeoutMs = Number(
  process.env.ROVE_LIFECYCLE_TURN_TIMEOUT_MS ?? "30000",
);
if (
  historyMode !== undefined &&
  historyMode !== "legacy" &&
  historyMode !== "paginated"
)
  throw new Error("ROVE_LIFECYCLE_HISTORY_MODE must be legacy or paginated.");
const state = await mkdtemp(join(tmpdir(), "rove-production-host-lifecycle-"));
await mkdir(join(state, "codex-home"), { recursive: true });
if (isolatedAuthFile)
  await copyFile(isolatedAuthFile, join(state, "codex-home", "auth.json"));
if (lifecycleConfig)
  await writeFile(join(state, "codex-home", "config.toml"), lifecycleConfig, {
    mode: 0o600,
  });
const createHost = () =>
  new CodexAppServerHost({
    resolver: new CodexExecutableResolver({
      isPackaged: false,
      developmentExecutablePath: executable,
      readVersion: readCodexVersion,
    }),
    clientVersion: "0.1.0",
    environment: useExistingAuth
      ? {}
      : { CODEX_HOME: join(state, "codex-home") },
  });
let host = createHost();
let threadId;
let restarted = false;
function fixtureToolResult(item) {
  const result = item.result;
  if (result === null || typeof result !== "object")
    throw new Error("Fixture MCP call returned no result.");
  if (Array.isArray(result.content)) {
    const text = result.content.find(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        entry.type === "text" &&
        typeof entry.text === "string",
    );
    if (!text) throw new Error("Fixture MCP result has no text content.");
    return JSON.parse(text.text);
  }
  return result;
}
try {
  await host.start();
  const account = await host.request("account/read", { refreshToken: false });
  const started = await host.request("thread/start", {
    cwd: lifecycleCwd ? resolve(lifecycleCwd) : resolve(here, "../.."),
    approvalPolicy: "never",
    ...(lifecyclePermissions
      ? { permissions: lifecyclePermissions }
      : { sandbox: lifecycleSandbox ?? "read-only" }),
    ...(historyMode === undefined ? {} : { historyMode }),
    threadSource: "rove-production-host-lifecycle",
    ephemeral: false,
    config: {
      ...(lifecyclePermissions
        ? { default_permissions: lifecyclePermissions }
        : {}),
      mcp_servers: {
        rove_lifecycle: {
          command: process.execPath,
          args: [resolve(here, "fixture-mcp-server.mjs")],
          env: {
            ROVE_TASK_ID: "task_lifecycle",
            ROVE_TASK_CAPABILITY: "rtcap_fixture_only",
          },
          enabled: true,
          required: true,
          startup_timeout_sec: 10,
        },
      },
      web_search: "disabled",
      browser_use: {
        allow_history_access: false,
        default_origin_policy: {
          access: "deny",
          downloads: "deny",
          uploads: "deny",
          full_cdp_access: "deny",
        },
        origins: {},
      },
      computer_use: { default_app_access: "deny" },
    },
  });
  threadId = started.thread.id;
  if (account.account === null)
    throw new Error("Safe fixture-MCP lifecycle requires existing Codex auth.");
  let turn;
  {
    const terminal = new Promise((resolvePromise, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Safe lifecycle turn timed out.")),
        lifecycleTurnTimeoutMs,
      );
      const detach = host.onEvent((event) => {
        if (
          event.method === "turn/completed" &&
          event.params.threadId === threadId
        ) {
          clearTimeout(timer);
          detach();
          resolvePromise(event.params.turn);
        }
      });
    });
    const startedTurn = await host.request("turn/start", {
      threadId,
      clientUserMessageId: "rove_lifecycle_safe_turn",
      input: [
        {
          type: "text",
          text:
            lifecyclePrompt ??
            'Call the rove_lifecycle MCP tool session.status exactly once with {"roveTaskId":"task_lifecycle","sessionId":"ses_fixture"}. Do not use any other tool. After it returns, report its exact JSON result.',
          text_elements: [],
        },
      ],
    });
    const completed = await terminal;
    const authoritative = await host.request("thread/read", {
      threadId,
      includeTurns: true,
    });
    const fixtureCalls = authoritative.thread.turns
      .flatMap((entry) => entry.items)
      .filter(
        (item) =>
          item.type === "mcpToolCall" &&
          item.server === "rove_lifecycle" &&
          item.tool === "session.status",
      );
    if (!lifecyclePrompt && fixtureCalls.length !== 1)
      throw new Error(
        `Expected one fixture session.status call, received ${fixtureCalls.length}.`,
      );
    const fixtureCall = fixtureCalls[0];
    if (
      !lifecyclePrompt &&
      (!fixtureCall ||
        fixtureCall.status !== "completed" ||
        fixtureCall.error !== null ||
        fixtureCall.arguments === null ||
        typeof fixtureCall.arguments !== "object" ||
        fixtureCall.arguments.roveTaskId !== "task_lifecycle" ||
        fixtureCall.arguments.sessionId !== "ses_fixture")
    )
      throw new Error(
        `Fixture session.status call identity is invalid: ${JSON.stringify({
          status: fixtureCall?.status,
          error: fixtureCall?.error,
          arguments: fixtureCall?.arguments,
        })}`,
      );
    const fixtureResult = fixtureCall ? fixtureToolResult(fixtureCall) : null;
    if (
      !lifecyclePrompt &&
      (!fixtureResult ||
        fixtureResult.roveTaskId !== "task_lifecycle" ||
        fixtureResult.roveSessionId !== "ses_fixture")
    )
      throw new Error("Fixture session.status result identity is invalid.");
    turn = {
      status: completed.status,
      id: startedTurn.turn.id,
      ...(lifecyclePrompt
        ? {
            agentText: authoritative.thread.turns
              .flatMap((entry) => entry.items)
              .flatMap((item) =>
                item.type === "agentMessage"
                  ? [item.text]
                  : item.type === "commandExecution" && item.aggregatedOutput
                    ? [item.aggregatedOutput]
                    : [],
              )
              .join("\n")
              .slice(0, 16_000),
          }
        : {}),
      ...(fixtureCall && fixtureResult
        ? {
            fixtureMcp: {
              server: fixtureCall.server,
              tool: fixtureCall.tool,
              taskId: fixtureResult.roveTaskId,
              sessionId: fixtureResult.roveSessionId,
            },
          }
        : {}),
    };
  }
  if (restartBeforeRecovery) {
    await host.stop();
    host = createHost();
    await host.start();
    restarted = true;
  }
  await host.request("thread/archive", { threadId });
  const unarchived = await host.request("thread/unarchive", { threadId });
  const read = await host.request("thread/read", {
    threadId,
    includeTurns: false,
  });
  const resumed = await host.request("thread/resume", {
    threadId,
    excludeTurns: true,
  });
  await host.request("thread/archive", { threadId });
  console.log(
    JSON.stringify(
      {
        ready: host.getHealth().ready,
        initialize: host.getNegotiatedIdentity(),
        emptyPreviewAccepted: started.thread.preview === "",
        computerUse: {
          defaultAppAccess: "deny",
          macosPresent: false,
          windowsPresent: false,
        },
        thread: {
          id: threadId,
          requestedHistoryMode: historyMode ?? null,
          returnedHistoryMode: started.thread.historyMode,
          processRestartedBeforeRecovery: restarted,
          read: read.thread.id === threadId,
          resumed: resumed.thread.id === threadId,
          unarchived: unarchived.thread.id === threadId,
          archived: true,
        },
        turn,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : String(error),
        health: host.getHealth(),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (threadId !== undefined)
    await host.request("thread/archive", { threadId }).catch(() => undefined);
  await host.stop().catch(() => undefined);
  await rm(state, { recursive: true, force: true });
}
