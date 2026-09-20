import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DesktopSurfaceSnapshot } from "../shared/desktop-api.js";
import {
  ArchivedTaskSettings,
  LocalBackupSettings,
  ProductSurface,
  SettingsNavigation,
  TaskArchiveConfirmation,
  browserIdentityLabel,
  canRemoveWorkflowFromCloud,
  compatibleReasoningEffort,
  commandPaletteMatches,
  currentOwnerWorkflowSyncBinding,
  deriveOutputTitle,
  followupDraftForTask,
  localBackupExportStatus,
  outputBodyForPresentation,
  outputKindForMessage,
  outputKindLabel,
  outputPreview,
  outputStatus,
  permissionReviewDescription,
  recordingLifecyclePresentation,
  removeWorkflowGuidanceEntry,
  removeWorkflowResourceEntry,
  taskNeedsCustomerInput,
  workflowConfigurationFromDraft,
  workflowDraft,
  workflowSynchronizationBadge,
  workflowSynchronizationDisclosure,
  workflowWorkspaceProjection,
  withTaskFollowupDraft,
} from "./product-surface.js";

const workspaceId = "wrk_00000000-0000-4000-8000-000000000001";

function snapshot(
  presentation: "chip" | "expanded" | "full" = "full",
): DesktopSurfaceSnapshot {
  return {
    revision: 1,
    surface: {
      presentation,
      browserContext: "windowed",
      activeHost:
        presentation === "full" ? "control_center" : "browser_follower",
      returnPresentation: "chip",
      revision: 1,
    },
    companion: null,
    notice: null,
    workspaces: {
      selectedWorkspaceId: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          displayName: "Personal",
          browser: "chrome",
          storageLayout: "workspace",
          createdAt: "2026-09-07T00:00:00Z",
          lastUsedAt: "2026-09-07T00:00:00Z",
        },
      ],
    },
    product: {
      version: 9,
      host: { state: "ready", ready: true, restartAttempt: 0 },
      catalog: {
        account: { status: "logged_out" },
        models: [],
        rateLimits: null,
        usage: null,
        refreshedAt: "2026-09-07T00:00:00Z",
      },
      attention: [],
      tasks: [],
      workflows: [],
      recoveryWarnings: [],
      draftAttachments: [],
      fileAttention: [],
    },
    productError: null,
  };
}

function synchronizedWorkflowSnapshot(): DesktopSurfaceSnapshot {
  const value = snapshot();
  const ownerId = "owner_11111111111141118111111111111111";
  const workflowId = "workflow_aaaaaaaa";
  value.roveAccount = {
    status: "signed_in",
    syncAvailable: true,
    ownerId,
    email: "owner@example.com",
    sessionPersistence: "encrypted",
  };
  value.product!.workflows = [
    {
      workflowId,
      name: "Owner workflow",
      archived: false,
      currentRevision: 1,
      revision: {
        workflowId,
        revision: 1,
        configuration: {
          purpose: "Owner-scoped rendering test",
          preferences: [],
          criteria: [],
          guidance: [],
          procedures: [],
          resourceRequirements: [],
          resultConventions: [],
          approvedKnowledge: [],
        },
        digest: "a".repeat(64),
        approvedAt: "2026-09-13T12:00:00.000Z",
      },
      createdAt: "2026-09-13T12:00:00.000Z",
      updatedAt: "2026-09-13T12:00:00.000Z",
    },
  ];
  value.workflowSync = {
    status: "ready",
    boundOwnerId: ownerId,
    signedInOwnerId: ownerId,
    lastError: null,
    lastFailureCode: null,
    items: { [workflowId]: "conflicted" },
    bindings: {
      [workflowId]: { eligibility: "owner_bound", status: "conflicted" },
    },
    exportableWorkflowCount: 1,
  };
  return value;
}

describe("ProductSurface accessibility and presentation continuity", () => {
  it("discloses optional Workflow synchronization without broadening its data boundary", () => {
    expect(workflowSynchronizationDisclosure(null, "editor")).toContain(
      "Stored on this device",
    );
    expect(
      workflowSynchronizationDisclosure(
        { eligibility: "owner_bound", status: "synchronized" },
        "editor",
      ),
    ).toContain("Synced with your Rove account");
    expect(
      workflowSynchronizationDisclosure(
        { eligibility: "owner_bound", status: "conflicted" },
        "editor",
      ),
    ).toContain("needs sync conflict resolution");
    expect(
      workflowSynchronizationDisclosure(
        { eligibility: "detached", status: "local_only" },
        "editor",
      ),
    ).toContain("no longer synchronized");
    expect(
      workflowSynchronizationDisclosure(
        { eligibility: "owner_bound", status: "unavailable" },
        "promotion",
      ),
    ).toContain("Sync will resume");
    for (const binding of [
      null,
      { eligibility: "owner_bound", status: "synchronized" } as const,
    ])
      expect(workflowSynchronizationDisclosure(binding, "editor")).toContain(
        "cannot guarantee detection of every secret",
      );
  });

  it("projects synchronization actions only for the active owner", () => {
    const value = synchronizedWorkflowSnapshot();
    const workflowId = "workflow_aaaaaaaa";
    const ownerA = "owner_11111111111141118111111111111111";
    const ownerB = "owner_22222222222242228222222222222222";

    expect(currentOwnerWorkflowSyncBinding(value, workflowId)).toEqual({
      eligibility: "owner_bound",
      status: "conflicted",
    });
    expect(canRemoveWorkflowFromCloud(value, workflowId)).toBe(false);

    value.roveAccount = {
      status: "signed_in",
      syncAvailable: true,
      ownerId: ownerB,
      email: "other-owner@example.com",
      sessionPersistence: "encrypted",
    };
    value.workflowSync = {
      ...value.workflowSync!,
      status: "account_mismatch",
      signedInOwnerId: ownerB,
      bindings: {
        [workflowId]: { eligibility: "other_owner", status: "conflicted" },
      },
    };
    const otherOwnerBinding = currentOwnerWorkflowSyncBinding(
      value,
      workflowId,
    );
    expect(otherOwnerBinding).toEqual({
      eligibility: "other_owner",
      status: null,
    });
    expect(workflowSynchronizationBadge(otherOwnerBinding)).toBe(
      "Not synced to this account",
    );
    expect(
      renderToStaticMarkup(
        <ProductSurface
          desktop={value}
          connectionError={null}
          follower={false}
          refresh={async () => undefined}
        />,
      ),
    ).not.toContain("Sync conflict");

    value.roveAccount = {
      status: "signed_in",
      syncAvailable: true,
      ownerId: ownerA,
      email: "owner@example.com",
      sessionPersistence: "encrypted",
    };
    value.workflowSync = {
      ...value.workflowSync,
      status: "ready",
      signedInOwnerId: ownerA,
      bindings: {
        [workflowId]: { eligibility: "owner_bound", status: "synchronized" },
      },
    };
    expect(canRemoveWorkflowFromCloud(value, workflowId)).toBe(true);
  });

  it("presents Archive as a reversible confirmation with Cancel and Archive choices", () => {
    const html = renderToStaticMarkup(
      <TaskArchiveConfirmation
        busy={false}
        archiving={false}
        error={null}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Archive this task?");
    expect(html).toContain("It will be removed from Task History.");
    expect(html).toContain("You can restore it later.");
    expect(html).toContain(">Cancel</button>");
    expect(html).toContain(">Archive</button>");
    expect(html).not.toContain("Delete");
  });

  it("keeps archived work out of the main sidebar and offers it from settings", () => {
    const value = snapshot();
    value.product!.tasks = [
      {
        taskId: "task_archived_ready",
        executionMode: "agent",
        browserIdentity: { mode: "temporary" },
        selectionSource: "user_selected",
        selectedAt: "2026-09-13T12:00:00.000Z",
        approvalsReviewer: "auto_review",
        bootstrapStage: "complete",
        results: [],
        conversation: {
          turnStatus: "completed",
          archived: true,
          items: {},
          turnOrder: [],
        },
        lifecycle: { phase: "ready", reason: "Ready for a follow-up." },
        availableActions: ["message", "resume"],
      },
    ];
    value.product!.attention = [
      {
        authority: "codex",
        kind: "network_approval",
        requestId: "request_archived_uncertain_effect",
        taskId: "task_archived_ready",
        threadId: "thread_archived",
        turnId: "turn_archived",
        itemId: "item_archived_effect",
        generation: 1,
        status: "resolution_unknown",
        sequence: 1,
        title: "Confirm the uncertain external action",
      },
    ];
    delete value.product!.currentTaskId;

    const html = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );

    expect(html).not.toContain("Archived tasks");
    expect(html).not.toContain(
      'aria-label="Task history: task_archived_ready"',
    );
    expect(html).toContain('aria-label="Open Rove profile settings"');
    expect(html).toContain("Rove profile");
    expect(html).toContain("Local profile");

    const settingsHtml = renderToStaticMarkup(
      <ArchivedTaskSettings
        product={value.product}
        busy={false}
        titleForTask={() => "Untitled task"}
        onOpen={() => undefined}
        onRestore={() => undefined}
      />,
    );
    expect(settingsHtml).toContain("Archived tasks");
    expect(settingsHtml).toContain("Needs attention · Preserved locally");
    expect(settingsHtml).toContain(
      'aria-label="Read archived task: task_archived_ready"',
    );
    expect(settingsHtml).toContain(">Restore</button>");

    const navigationHtml = renderToStaticMarkup(
      <SettingsNavigation
        active="archived-tasks"
        archivedTaskCount={1}
        onSelect={() => undefined}
      />,
    );
    expect(navigationHtml).toContain('aria-label="Settings sections"');
    expect(navigationHtml).toContain("Appearance");
    expect(navigationHtml).toContain(
      '<button type="button" aria-current="page"><span>Archived tasks</span>',
    );

    const styles = readFileSync(
      new URL("./styles.css", import.meta.url),
      "utf8",
    );
    expect(styles).toContain(
      ".product-sidebar .task-history::-webkit-scrollbar",
    );
    expect(styles).toContain("width: 2px;");
    expect(styles).toContain("scrollbar-color: transparent transparent;");
  });

  it("renders an accepted customer message before any provider turn exists", () => {
    const value = snapshot();
    value.product!.tasks = [
      {
        taskId: "task_accepted_local",
        executionMode: "agent",
        browserIdentity: { mode: "temporary" },
        selectionSource: "user_selected",
        selectedAt: "2026-09-20T00:00:00.000Z",
        approvalsReviewer: "auto_review",
        bootstrapStage: "intent_persisted",
        results: [],
        conversation: {
          turnStatus: "unknown",
          archived: false,
          items: {
            "user:intent_local": {
              id: "user:intent_local",
              kind: "user_message",
              status: "completed",
              acceptedAt: "2026-09-20T00:00:00.000Z",
              completedAt: "2026-09-20T00:00:00.000Z",
              clientId: "intent_local",
              deliveryState: "pending",
              text: "Keep this exact instruction visible.",
            },
          },
          itemOrder: ["user:intent_local"],
          turnOrder: [],
        },
        lifecycle: { phase: "starting", reason: "Starting this task." },
        availableActions: ["finish"],
      },
    ];
    value.product!.currentTaskId = "task_accepted_local";

    const html = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(html).toContain("Keep this exact instruction visible.");
    expect(html).toContain("Sending…");
    expect(html).not.toContain("Starting this task.");
  });

  it("derives the restrained renderer accent from the canonical Rove mark", () => {
    const logo = readFileSync(
      new URL("./assets/rove-mark.png", import.meta.url),
    );
    const surface = readFileSync(
      new URL("./product-surface.tsx", import.meta.url),
      "utf8",
    );
    const styles = readFileSync(
      new URL("./styles.css", import.meta.url),
      "utf8",
    );
    expect(logo.byteLength).toBeGreaterThan(1_000);
    expect(surface).toContain('from "./assets/rove-mark.png"');
    expect(surface).not.toContain('from "./assets/rove-mark.svg"');
    expect(surface).toContain(
      "aria-label={`Open Output: ${result.revision.title}`}",
    );
    expect(surface).not.toContain(
      "aria-label={`Open Workflow output: ${result.resultId}`}",
    );
    expect(styles).toContain("--rove-accent: #c16137;");
    expect(styles).toContain("--rove-accent-text: var(--rove-accent-strong);");
    expect(styles).toContain("--rove-accent-text: var(--rove-accent-visible);");
    expect(styles).toContain("--rove-accent-contrast: #faf5ee;");
    expect(styles).not.toContain("--rove-accent: #245846;");
    expect(styles).toContain("--success: #2f6f52;");
    expect(styles).toContain("--warning: #a86d18;");
    expect(styles).toContain("--danger: #a94848;");
    expect(styles).toContain(
      '.product-app .task-history-row[data-current="true"]',
    );
    expect(styles).toContain("background: var(--rove-accent-soft) !important;");
    expect(styles).toContain(
      '.browser-status[data-attached="true"] .browser-status-icon',
    );
    expect(styles).toContain('.task-history-row[data-needs-input="true"]');
    expect(styles).toContain("color: var(--warning);");
    expect(styles).toContain(
      '.recording-history-heading span[data-result-state="available"]',
    );
    expect(styles).toContain("color: var(--success);");
  });

  it("derives safe Output presentation without exposing Action creation", () => {
    expect(
      deriveOutputTitle(
        "## Weekly product update\n\nThe team completed the launch review.",
      ),
    ).toBe("Weekly product update");
    expect(outputKindForMessage("## Findings\n\nThree useful patterns.")).toBe(
      "finding_collection",
    );
    expect(outputKindForMessage("## Weekly product update\n\nReady.")).toBe(
      "draft",
    );
    expect(outputKindLabel("finding_collection")).toBe("Findings");
    expect(outputKindLabel("artifact")).toBe("File");
    expect(outputPreview("Update", "## Update\n\n**Ready** for review.")).toBe(
      "Ready for review.",
    );
  });

  it("suppresses only a duplicate first Output heading in presentation", () => {
    expect(
      outputBodyForPresentation(
        "Weekly product update",
        "# Weekly product update\n\nReady for review.",
      ),
    ).toBe("Ready for review.");
    expect(
      outputBodyForPresentation(
        "Weekly product update",
        "\n  ##   WEEKLY   PRODUCT UPDATE  \n\nReady for review.",
      ),
    ).toBe("Ready for review.");
    expect(
      outputBodyForPresentation(
        "Weekly product update",
        "# Launch risks\n\nReady for review.",
      ),
    ).toBe("# Launch risks\n\nReady for review.");
    expect(
      outputBodyForPresentation(
        "Weekly product update",
        "Ready for review without a heading.",
      ),
    ).toBe("Ready for review without a heading.");
  });

  it("translates Action lifecycle truth without using brand semantics", () => {
    const action = {
      resultId: "result_action",
      taskId: "task_action",
      kind: "action" as const,
      lifecycle: "prepared" as const,
      selected: false,
      currentRevision: 1,
      revision: {
        resultId: "result_action",
        revision: 1,
        title: "Send update",
        body: "Prepared update",
        artifactIds: [],
        digest: "a".repeat(64),
        createdAt: "2026-09-13T11:00:00Z",
      },
      source: { evidenceIds: [] },
      actionMaterial: { content: "Update", attachmentIds: [] },
      materialDigest: "b".repeat(64),
      createdAt: "2026-09-13T11:00:00Z",
      updatedAt: "2026-09-13T11:00:00Z",
    };
    expect(outputStatus(action)).toEqual({
      label: "Ready for approval",
      description: "Nothing has been sent yet.",
      tone: "neutral",
    });
    expect(outputStatus({ ...action, lifecycle: "dispatched" })?.label).toBe(
      "Checking outcome",
    );
    expect(outputStatus({ ...action, lifecycle: "confirmed" })?.label).toBe(
      "Sent",
    );
    expect(outputStatus({ ...action, lifecycle: "unresolved" })).toEqual(
      expect.objectContaining({
        label: "Outcome unclear",
        description: expect.stringMatching(/before trying again/i),
        tone: "warning",
      }),
    );
  });

  it("keeps ambient task controls visible and long-tail controls searchable", () => {
    expect(commandPaletteMatches("work", "Workflow", "Task mode")).toBe(true);
    expect(commandPaletteMatches("reason", "Model", "Reasoning effort")).toBe(
      true,
    );
    expect(commandPaletteMatches("record", "Workflow", "Task mode")).toBe(
      false,
    );
    const html = renderToStaticMarkup(
      <ProductSurface
        desktop={snapshot()}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(html).toContain('aria-label="Commands"');
    expect(html).toContain('aria-label="Search commands"');
    expect(html).toContain('aria-label="Workflow environment"');
    expect(html).toContain('class="composer-ambient-controls"');
    expect(html).toContain('aria-label="Participation mode: Agent"');
    expect(html).toContain('aria-label="Approval policy: Approve for me"');
    expect(html).toContain('aria-label="Model and reasoning effort:');
    expect(html).toContain('class="product-health-label"');
    expect(html).toContain('title="Not signed in to Codex"');
    expect(html).toContain(
      'class="sidebar-new-task" type="button" aria-current="page"',
    );
  });

  it("reconciles reasoning effort from the selected catalog model", () => {
    const model = { efforts: ["low", "medium"], defaultEffort: "medium" };
    expect(compatibleReasoningEffort(model, "low")).toBe("low");
    expect(compatibleReasoningEffort(model, "high")).toBe("medium");
  });

  it("offers an explicit managed-credential-store exclusion boundary", () => {
    const html = renderToStaticMarkup(
      <LocalBackupSettings busy={false} status={null} onExport={() => {}} />,
    );
    expect(html).toContain("Export local backup");
    expect(html).toContain("may contain sensitive task content");
    expect(html).toContain("excludes its managed");
    expect(html).toContain("credential stores");
    expect(html).toContain("not Workflow sync");
    expect(html).toContain("Restore is not available yet");
  });

  it("keeps local backup creation, cancellation, and failure presentation distinct", () => {
    expect(
      localBackupExportStatus({
        status: "created",
        name: "rove-backup",
        fileCount: 8,
        missingCount: 0,
      }),
    ).toBe("rove-backup created with 8 files.");
    expect(localBackupExportStatus({ status: "cancelled" })).toBe(
      "Backup export cancelled. No backup was created.",
    );
    expect(localBackupExportStatus({ status: "cancelled" })).not.toMatch(
      /attention|retry|failed/i,
    );
  });

  it("projects recording lifecycle into distinct customer states and actions", () => {
    expect(recordingLifecyclePresentation("requested")).toEqual({
      summary: "Starting page recording…",
      stateLabel: "Starting…",
      actionLabel: "Starting page recording…",
      canStop: false,
    });
    expect(recordingLifecyclePresentation("recording")).toMatchObject({
      summary: "Page recording active",
      actionLabel: "Stop page recording",
      canStop: true,
    });
    expect(recordingLifecyclePresentation("finalizing")).toMatchObject({
      summary: "Finalizing recording",
      actionLabel: "Finalizing recording…",
      canStop: false,
    });
    expect(recordingLifecyclePresentation("available")).toMatchObject({
      summary: "Recording available",
      actionLabel: "Open recording",
    });
    expect(recordingLifecyclePresentation("failed")).toMatchObject({
      summary: "Recording unavailable",
      actionLabel: null,
    });
  });

  it("shows browser identity only for the exact attached task", () => {
    const value = snapshot();
    const detached = {
      browserIdentity: { mode: "workspace", workspaceId },
    } as never;
    const attached = {
      browserIdentity: { mode: "workspace", workspaceId },
      runtime: { attachment: "attached" },
    } as never;
    const anotherTaskAttached = {
      browserIdentity: { mode: "temporary" },
      runtime: { attachment: "missing" },
    } as never;

    expect(browserIdentityLabel(value, detached)).toBe("No browser attached");
    expect(browserIdentityLabel(value, attached)).toBe("Personal");
    expect(browserIdentityLabel(value, anotherTaskAttached)).toBe(
      "No browser attached",
    );
  });

  it("marks only pending task-scoped conversational attention as needing input", () => {
    const value = snapshot();
    const attention = {
      authority: "codex",
      kind: "user_input",
      requestId: "question_a",
      taskId: "task_a",
      generation: 1,
      status: "pending",
      sequence: 1,
      title: "Choose one",
      questions: [],
    } as const;
    value.product!.attention = [attention];

    expect(taskNeedsCustomerInput(value.product, "task_a")).toBe(true);
    expect(taskNeedsCustomerInput(value.product, "task_b")).toBe(false);
    value.product!.attention = [{ ...attention, status: "responding" }];
    expect(taskNeedsCustomerInput(value.product, "task_a")).toBe(false);
  });

  it("shows truthful page-recording controls and ownership in every mode", () => {
    for (const mode of ["agent", "companion", "capture"] as const) {
      const value = snapshot();
      value.product!.catalog.account = {
        status: "logged_in",
        authMode: "chatgpt",
      };
      value.product!.tasks = [
        {
          taskId: `task_${mode}`,
          executionMode: mode,
          browserIdentity: { mode: "temporary" },
          selectionSource: "user_selected",
          selectedAt: "2026-09-13T12:00:00.000Z",
          approvalsReviewer: "auto_review",
          bootstrapStage: "complete",
          results: [],
          conversation: {
            turnStatus: "completed",
            archived: false,
            items: {},
            turnOrder: [],
          },
          recordings: [
            {
              schemaVersion: 1,
              id: `rec_${"a".repeat(32)}`,
              taskId: `task_${mode}`,
              sessionId: `ses_${"b".repeat(32)}`,
              mode,
              state: "recording",
              scope: {
                kind: "page",
                pageId: `page_${"c".repeat(32)}`,
                url: "https://example.test/work",
              },
              sensitiveDataPolicy: "user_confirmed_visible_content",
              includesAudio: false,
              coverage: "Selected page.",
              exclusions: ["Other tabs"],
              requestedAt: "2026-09-13T12:00:00.000Z",
              updatedAt: "2026-09-13T12:00:01.000Z",
              startedAt: "2026-09-13T12:00:01.000Z",
            },
            {
              schemaVersion: 1,
              id: `rec_${"d".repeat(32)}`,
              taskId: `task_${mode}`,
              sessionId: `ses_${"b".repeat(32)}`,
              mode,
              state: "failed",
              scope: {
                kind: "page",
                pageId: `page_${"e".repeat(32)}`,
                url: "https://example.test/failed",
              },
              sensitiveDataPolicy: "user_confirmed_visible_content",
              includesAudio: false,
              coverage: "Selected page.",
              exclusions: ["Other tabs"],
              requestedAt: "2026-09-13T11:00:00.000Z",
              updatedAt: "2026-09-13T11:00:01.000Z",
              failure: {
                code: "FINALIZATION_FAILED",
                message: "The recording could not be finalized.",
              },
            },
          ],
          roveSessionId: `ses_${"b".repeat(32)}`,
          lifecycle: { phase: "working", reason: "Active." },
          availableActions: ["finish"],
        },
      ];
      value.product!.currentTaskId = `task_${mode}`;
      const html = renderToStaticMarkup(
        <ProductSurface
          desktop={value}
          connectionError={null}
          follower={false}
          refresh={async () => undefined}
        />,
      );
      expect(html).toContain("Page recording active");
      expect(html).toContain(
        {
          agent: "Participation mode: Agent",
          companion: "Participation mode: Companion",
          capture: "Capture · Human-driven",
        }[mode],
      );
      expect(html).toContain("Stop page recording");
      expect(html).toContain("Continuous video is not masked");
      expect(html).toContain("Recording unavailable");
      expect(html).toContain("could not be finalized");
    }
  });

  it("keeps follow-up drafts isolated while switching tasks", () => {
    const first = withTaskFollowupDraft({}, "task_a", "Follow up on A");
    const switched = withTaskFollowupDraft(
      first,
      "task_b",
      "Different follow-up for B",
    );
    expect(followupDraftForTask(switched, "task_a")).toBe("Follow up on A");
    expect(followupDraftForTask(switched, "task_b")).toBe(
      "Different follow-up for B",
    );
    expect(followupDraftForTask(switched, "task_missing")).toBe("");
  });

  it("round-trips every represented Workflow configuration class without a lossy edit", () => {
    const workflow = {
      workflowId: "workflow_roundtrip",
      name: "Round trip",
      archived: false,
      currentRevision: 4,
      revision: {
        workflowId: "workflow_roundtrip",
        revision: 4,
        digest: "d".repeat(64),
        approvedAt: "2026-09-13T00:00:00Z",
        configuration: {
          purpose: "Review launches",
          preferences: [
            { id: "pref", text: "Prefer evidence", appliesTo: ["review"] },
            {
              id: "pref_release",
              text: "Prefer release notes",
              appliesTo: ["release", "writing"],
            },
          ],
          criteria: [
            { id: "criterion", text: "Exclude guesses", appliesTo: [] },
          ],
          guidance: [
            { id: "guide", text: "Be precise", appliesTo: ["release"] },
          ],
          procedures: [
            {
              id: "procedure",
              text: "Run qualification",
              appliesTo: ["review"],
            },
          ],
          resourceRequirements: [
            {
              id: "resource",
              kind: "account" as const,
              label: "GitHub account",
            },
            {
              id: "resource_site",
              kind: "website" as const,
              label: "Public release page",
            },
          ],
          resultConventions: [
            { id: "result", text: "Include sources", appliesTo: ["review"] },
          ],
          approvedKnowledge: [
            {
              id: "knowledge",
              text: "Main is protected",
              appliesTo: ["release"],
            },
          ],
        },
      },
      createdAt: "2026-09-13T00:00:00Z",
      updatedAt: "2026-09-13T00:00:00Z",
    };
    expect(workflowConfigurationFromDraft(workflowDraft(workflow))).toEqual(
      workflow.revision.configuration,
    );

    const draft = workflowDraft(workflow);
    draft.preferences = [draft.preferences[1]!, draft.preferences[0]!];
    draft.resourceRequirements = [
      draft.resourceRequirements[1]!,
      draft.resourceRequirements[0]!,
    ];
    draft.focus = "outreach";
    expect(workflowConfigurationFromDraft(draft)).toMatchObject({
      preferences: [
        {
          id: "pref_release",
          text: "Prefer release notes",
          appliesTo: ["release", "writing"],
        },
        { id: "pref", text: "Prefer evidence", appliesTo: ["review"] },
      ],
      resourceRequirements: [
        {
          id: "resource_site",
          kind: "website",
          label: "Public release page",
        },
        { id: "resource", kind: "account", label: "GitHub account" },
      ],
    });
    expect(
      removeWorkflowGuidanceEntry(draft.preferences, "pref_release"),
    ).toEqual([{ id: "pref", text: "Prefer evidence", appliesTo: "review" }]);
    expect(
      removeWorkflowResourceEntry(draft.resourceRequirements, "resource_site"),
    ).toEqual([{ id: "resource", kind: "account", label: "GitHub account" }]);
  });
  it("shows durable Workflow navigation, standalone choice, and task association", () => {
    const value = snapshot();
    value.product!.workflows = [
      {
        workflowId: "workflow_jobs",
        name: "Job search",
        archived: false,
        currentRevision: 2,
        revision: {
          workflowId: "workflow_jobs",
          revision: 2,
          configuration: {
            purpose: "Find suitable roles",
            preferences: [],
            criteria: [],
            guidance: [],
            procedures: [],
            resourceRequirements: [],
            resultConventions: [],
            approvedKnowledge: [],
          },
          digest: "a".repeat(64),
          approvedAt: "2026-09-13T10:00:00Z",
        },
        createdAt: "2026-09-13T09:00:00Z",
        updatedAt: "2026-09-13T10:00:00Z",
      },
      {
        workflowId: "workflow_archived",
        name: "Past reviews",
        archived: true,
        currentRevision: 1,
        revision: {
          workflowId: "workflow_archived",
          revision: 1,
          configuration: {
            purpose: "Review old work",
            preferences: [],
            criteria: [],
            guidance: [],
            procedures: [],
            resourceRequirements: [],
            resultConventions: [],
            approvedKnowledge: [],
          },
          digest: "b".repeat(64),
          approvedAt: "2026-09-13T10:00:00Z",
        },
        createdAt: "2026-09-13T09:00:00Z",
        updatedAt: "2026-09-13T10:00:00Z",
      },
    ];
    value.product!.tasks = [
      {
        taskId: "task_workflow",
        executionMode: "agent",
        selectionSource: "user_selected",
        selectedAt: "2026-09-13T10:00:00Z",
        approvalsReviewer: "auto_review",
        bootstrapStage: "complete",
        results: [],
        workflowAssociation: {
          workflowId: "workflow_jobs",
          workflowName: "Job search",
        },
        lifecycle: { phase: "closed", reason: "Closed." },
        availableActions: ["archive"],
      },
    ];
    const html = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(html).toContain('aria-label="Create Workflow"');
    expect(html).not.toContain("Local work remains available");
    expect(html).toContain("Job search");
    expect(html).toContain("Past reviews");
    expect(html).toContain("Archived · 0 tasks");
    expect(html).toContain('aria-label="Workflow environment"');
    expect(html).toContain("Standalone task");
    expect(html).toContain("Job search · Completed");
  });

  it("projects only exact Workflow tasks, outputs, and attention", () => {
    const value = snapshot();
    value.product!.workflows = [
      {
        workflowId: "workflow_jobs",
        name: "Job search",
        archived: false,
        currentRevision: 1,
        revision: {
          workflowId: "workflow_jobs",
          revision: 1,
          configuration: {
            purpose: "",
            preferences: [],
            criteria: [],
            guidance: [],
            procedures: [],
            resourceRequirements: [],
            resultConventions: [],
            approvedKnowledge: [],
          },
          digest: "a".repeat(64),
          approvedAt: "2026-09-13T10:00:00Z",
        },
        createdAt: "2026-09-13T10:00:00Z",
        updatedAt: "2026-09-13T10:00:00Z",
      },
    ];
    const result = {
      resultId: "result_jobs",
      taskId: "task_jobs",
      kind: "report" as const,
      lifecycle: "prepared" as const,
      selected: false,
      currentRevision: 3,
      revision: {
        resultId: "result_jobs",
        revision: 3,
        title: "Role shortlist",
        body: "Three suitable roles.",
        artifactIds: [],
        digest: "b".repeat(64),
        createdAt: "2026-09-13T11:00:00Z",
      },
      source: { evidenceIds: [] },
      createdAt: "2026-09-13T11:00:00Z",
      updatedAt: "2026-09-13T11:00:00Z",
    };
    value.product!.tasks = [
      {
        taskId: "task_jobs",
        executionMode: "agent",
        selectionSource: "user_selected",
        selectedAt: "2026-09-13T11:00:00Z",
        approvalsReviewer: "auto_review",
        bootstrapStage: "complete",
        results: [result],
        workflowAssociation: {
          workflowId: "workflow_jobs",
          workflowName: "Job search",
        },
        lifecycle: { phase: "waiting_for_human", reason: "Choose a role." },
        availableActions: [],
      },
      {
        taskId: "task_standalone",
        executionMode: "agent",
        selectionSource: "user_selected",
        selectedAt: "2026-09-13T12:00:00Z",
        approvalsReviewer: "auto_review",
        bootstrapStage: "complete",
        results: [
          {
            ...result,
            resultId: "result_unrelated",
            taskId: "task_standalone",
          },
        ],
        lifecycle: { phase: "closed", reason: "Done." },
        availableActions: ["archive"],
      },
    ];
    value.product!.attention = [
      {
        authority: "codex",
        kind: "user_input",
        requestId: "request_jobs",
        taskId: "task_jobs",
        threadId: "thread_jobs",
        turnId: "turn_jobs",
        itemId: "item_jobs",
        generation: 1,
        status: "pending",
        sequence: 1,
        title: "Choose a role",
        questions: [],
      },
      {
        authority: "codex",
        kind: "user_input",
        requestId: "request_unrelated",
        taskId: "task_standalone",
        threadId: "thread_standalone",
        turnId: "turn_standalone",
        itemId: "item_standalone",
        generation: 1,
        status: "pending",
        sequence: 2,
        title: "Unrelated attention",
        questions: [],
      },
    ];

    const projected = workflowWorkspaceProjection(
      value.product!,
      "workflow_jobs",
    );
    expect(projected.tasks.map((task) => task.taskId)).toEqual(["task_jobs"]);
    expect(
      projected.outputs.map(({ result: output }) => output.resultId),
    ).toEqual(["result_jobs"]);
    expect(projected.outputs[0]!.result.currentRevision).toBe(3);
    expect(projected.attention.map((entry) => entry.requestId)).toEqual([
      "request_jobs",
    ]);
  });

  it("renders pre-launch attachment chips and distinct file-attention controls", () => {
    const value = snapshot();
    value.product!.catalog.account = {
      status: "logged_in",
      authMode: "chatgpt",
    };
    value.product!.draftAttachments = [
      {
        id: `att_${"a".repeat(32)}`,
        filename: "upload.txt",
        mimeType: "text/plain",
        size: 74,
        sha256: "f".repeat(64),
        status: "ready",
      },
    ];
    value.product!.fileAttention = [
      {
        requestId: "file_request_a",
        taskId: "task_a",
        sessionId: "ses_a",
        reason: "Choose the document to upload",
        allowMultiple: false,
        status: "waiting",
      },
    ];
    const html = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(html).toContain("Attach files");
    expect(html).toContain("upload.txt");
    expect(html).toContain('aria-label="Selected task attachments"');
    expect(html).toContain('aria-label="Replace upload.txt"');
    expect(html).toContain('aria-label="Remove upload.txt"');
    expect(html).toContain(">TXT</small>");
    expect(html).toContain('aria-label="File selection needed"');
    expect(html).toContain("Select files");
    expect(html).toContain("Cancel");
    expect(html).not.toContain("/tmp/");
  });

  it("shows the composer while retaining selectable terminal history", () => {
    const value = snapshot();
    value.product!.catalog.account = {
      status: "logged_in",
      authMode: "chatgpt",
    };
    value.product!.tasks = [
      {
        taskId: "task_terminal",
        executionMode: "agent",
        browserIdentity: { mode: "workspace", workspaceId },
        selectionSource: "user_selected",
        selectedAt: "2026-09-08T00:00:00Z",
        approvalsReviewer: "auto_review",
        bootstrapStage: "complete",
        results: [],
        lifecycle: { phase: "closed", reason: "Closed." },
        availableActions: ["archive"],
      },
    ];

    const html = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(html).toContain('aria-label="Desired outcome"');
    expect(html).toContain('class="product-main product-main-composer"');
    expect(html).toContain('class="composer-welcome"');
    expect(html).toContain('aria-label="Task history: task_terminal"');
    expect(html).toContain('aria-label="Archive Untitled task"');
    expect(html).toContain(">New task</strong>");
    expect(html).not.toContain(">Clear</button>");
    expect(html).not.toContain("Back to new task");
    expect(html).not.toContain("New task blocked");
  });

  it("keeps first launch task-focused and places Codex access in execution status", () => {
    const value = snapshot();
    const signedOut = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(signedOut).toContain("Not signed in to Codex");
    expect(signedOut).toContain(">Sign in</button>");
    expect(signedOut).toContain('aria-label="Desired outcome"');
    expect(signedOut).toContain('aria-label="Create Workflow"');
    expect(signedOut).not.toContain("Reusable guidance for recurring work");
    expect(signedOut).not.toContain("ChatGPT account");
    expect(signedOut).not.toContain("Connecting");
    expect(signedOut).toContain(
      'aria-label="Start task" title="Not signed in to Codex."',
    );

    value.product!.catalog.account = {
      status: "logged_in",
      authMode: "chatgpt",
      planType: "self_serve_business_prolite",
    };
    const html = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(html).toContain('aria-label="Desired outcome"');
    expect(html).toContain('aria-label="Participation mode: Agent"');
    expect(html).toContain('aria-label="Execution mode: Agent"');
    expect(html).toContain('aria-label="Browser profile: Personal"');
    expect(html).toContain('aria-label="Browser profile: Guest"');
    expect(html).toContain('aria-label="Rove settings"');
    expect(html).toContain("Browser profiles");
    expect(html).not.toContain("Browser workspace</span>");
    expect(html).toContain('aria-label="Approval policy: Approve for me"');
    expect(html).toContain('aria-label="Model and reasoning effort:');
    expect(html).toContain('aria-pressed="true"><span>Approve for me</span>');
    expect(html).toContain("Always ask");
    expect(html).not.toContain("Routine eligible requests are reviewed");
    expect(html).toContain("Codex ready");
    expect(html).not.toContain("ChatGPT account");
    expect(html).not.toContain("self_serve_business_prolite");
    expect(html).toContain("Codex usage");
    expect(html).toContain("Settings");
    expect(html).toContain("Sign out of Codex");
    expect(html).not.toContain("Usage window");
    expect(html).not.toContain("Token activity");
    expect(html).not.toContain(">Refresh</button>");
  });

  it("states that permission review is unused by Capture and starts no Codex turn", () => {
    expect(permissionReviewDescription("capture", "auto_review")).toBe(
      "Permission review is unused in Capture mode because Capture starts no Codex turn.",
    );
  });

  it("does not scatter a login failure outside the focused recovery surface", () => {
    const value = snapshot();
    value.product!.catalog.account = {
      status: "logged_out",
      requiresOpenaiAuth: true,
      error: "Rove sign-in did not complete. Try again or use device code.",
    };
    const html = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(html).toContain("Not signed in to Codex");
    expect(html).not.toContain(
      "Rove sign-in did not complete. Try again or use device code.",
    );
    expect(html.match(/>Sign in<\/button>/g)).toHaveLength(1);
  });

  it("keeps local Codex compatibility diagnostics out of customer recovery copy", () => {
    const value = snapshot();
    value.product = null;
    value.productError =
      "Codex 0.154.0 is not reviewed baseline 0.153.4; sha256 deadbeef.";
    const html = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(html).toContain("Codex couldn&#x27;t start");
    expect(html).not.toContain(">Retry</button>");
    expect(html).not.toMatch(/0\.154|0\.153|baseline|sha256|App Server/);
    expect(html).not.toContain("Rove needs attention");
  });

  it("shows an unmatched Runtime cleanup card without inventing a product task", () => {
    const value = snapshot();
    value.product!.catalog.account = {
      status: "logged_in",
      authMode: "chatgpt",
    };
    value.companion = {
      session: {
        id: "ses_unmatched",
        mode: "agent",
        status: "active",
        controller: "agent",
      },
      observationCount: 2,
      evidenceCount: 7,
    };
    expect(value.product!.tasks).toEqual([]);
    const html = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(html).toContain('aria-label="Unmatched browser session"');
    expect(html).toContain("Browser session needs cleanup");
    expect(html).toContain("Status: active. Controller: agent.");
    expect(html).toContain("Finish session");
    expect(html).toContain('aria-label="Desired outcome"');

    value.surface.presentation = "expanded";
    value.surface.activeHost = "browser_follower";
    const expanded = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower
        refresh={async () => undefined}
      />,
    );
    expect(expanded).toContain("Browser session needs cleanup");
    expect(expanded).toContain("Automate · Agent mode · active");
    expect(expanded).toContain("Finish session");

    value.surface.presentation = "chip";
    const chip = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower
        refresh={async () => undefined}
      />,
    );
    expect(chip).toContain(
      'aria-label="Expand Rove. Browser session needs cleanup"',
    );
  });

  it("renders distinct Codex approval and Rove handoff actions with current task identity", () => {
    const value = snapshot();
    value.product!.catalog.account = {
      status: "logged_in",
      authMode: "chatgpt",
    };
    value.companion = {
      session: {
        id: "ses_active",
        mode: "companion",
        status: "awaiting_human",
        controller: null,
      },
      observationCount: 1,
      evidenceCount: 0,
      browserOpen: true,
    };
    value.product!.tasks = [
      {
        taskId: "task_active",
        executionMode: "companion",
        browserIdentity: { mode: "workspace", workspaceId },
        selectionSource: "user_selected",
        selectedAt: "2026-09-07T00:00:00Z",
        approvalsReviewer: "user",
        bootstrapStage: "complete",
        results: [],
        roveSessionId: "ses_active",
        codexThreadId: "thread_active",
        lifecycle: { phase: "working", reason: "Codex is working." },
        availableActions: ["interrupt", "finish", "return_control"],
        runtime: {
          status: "awaiting_human",
          controller: null,
          attachment: "attached",
          recovery: "not_needed",
          profileOwnership: "owned",
          handoffActionable: true,
          handoffGeneration: 3,
        },
        conversation: {
          turnStatus: "in_progress",
          archived: false,
          items: {},
          turnOrder: ["turn_active"],
          activeTurnId: "turn_active",
        },
      },
    ];
    value.product!.currentTaskId = "task_active";
    value.product!.attention = [
      {
        authority: "codex",
        kind: "file_approval",
        requestId: "approval_1",
        taskId: "task_active",
        threadId: "thread_active",
        turnId: "turn_active",
        itemId: "item_active",
        generation: 4,
        status: "pending",
        sequence: 1,
        title: "File change approval",
      },
      {
        authority: "rove_control",
        kind: "control_handoff",
        requestId: "control:ses_active:3",
        taskId: "task_active",
        threadId: "thread_active",
        turnId: "turn_active",
        generation: 3,
        status: "pending",
        sequence: 2,
        title: "Browser control handoff",
      },
      {
        authority: "codex",
        kind: "user_input",
        requestId: "question_2",
        taskId: "task_active",
        threadId: "thread_active",
        turnId: "turn_active",
        itemId: "item_question_2",
        generation: 4,
        status: "pending",
        sequence: 3,
        title: "Later question",
      },
    ];
    const html = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(html).toContain("Input needed");
    expect(html).toContain('class="product-task-nav"');
    expect(html).not.toContain('class="task-heading"');
    expect(html).toContain('aria-label="Current task request"');
    expect(html.match(/aria-label="Current task request"/g)).toHaveLength(1);
    expect(html).not.toContain("Later question");
    expect(html).not.toContain('class="side-card attention-card');
    expect(html).not.toContain("task-composer-shell");
    expect(html).toContain("Approve / Send");
    expect(html).toContain("Browser control handoff");
    expect(html).toContain("Take Over");
    expect(html).toContain("Personal");
    expect(html).toContain('aria-label="Browser status"');
    expect(html).toContain(">View Browser</button>");
    expect(html).toContain('aria-label="Task inspector"');
    expect(html.indexOf('aria-label="Task inspector"')).toBeGreaterThan(
      html.indexOf('aria-label="Task controls and status"'),
    );
    expect(html).toContain("Awaiting handoff");

    value.product!.tasks[0]!.runtime!.handoffActionable = false;
    const mismatched = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(mismatched).toContain("Awaiting handoff");
    expect(mismatched).not.toContain(">Take Over</button>");
    value.product!.tasks[0]!.runtime!.handoffActionable = true;

    value.companion.browserOpen = false;
    const browserClosed = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(browserClosed).toContain(">Open Browser</button>");

    value.surface.presentation = "expanded";
    const expanded = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower
        refresh={async () => undefined}
      />,
    );
    expect(expanded).toContain("Awaiting handoff");
    expect(expanded).toContain("Take Over");

    value.surface.presentation = "chip";
    const chip = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower
        refresh={async () => undefined}
      />,
    );
    expect(chip).toContain('aria-label="Expand Rove. Attention required"');

    const reason = "Quick handover visibility test";
    value.companion.session = {
      ...value.companion.session,
      status: "active",
      controller: "human",
      handoff: {
        reason,
        requestedAt: "2026-09-07T00:01:00.000Z",
      },
    };
    value.product!.tasks = [
      {
        ...value.product!.tasks[0]!,
        lifecycle: {
          phase: "waiting_for_human",
          reason,
        },
        availableActions: ["finish", "return_control"],
        runtime: {
          status: "active",
          controller: "human",
          attachment: "attached",
          recovery: "not_needed",
          profileOwnership: "owned",
        },
      },
    ];
    value.surface.presentation = "full";
    const humanOwnedFull = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(humanOwnedFull).toContain(reason);
    expect(humanOwnedFull).toContain("Return control");
    expect(humanOwnedFull).not.toContain("Retry cleanup");

    value.surface.presentation = "expanded";
    const humanOwnedCompact = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower
        refresh={async () => undefined}
      />,
    );
    expect(humanOwnedCompact).toContain(reason);
    expect(humanOwnedCompact).toContain("Return Control");
    expect(humanOwnedCompact).not.toContain("Retry cleanup");
  });

  it("presents one bounded user question as a focused choice response", () => {
    const value = snapshot();
    value.product!.catalog.account = {
      status: "logged_in",
      authMode: "chatgpt",
    };
    value.product!.tasks = [
      {
        taskId: "task_choice",
        executionMode: "agent",
        selectionSource: "user_selected",
        selectedAt: "2026-09-13T12:00:00Z",
        approvalsReviewer: "user",
        bootstrapStage: "complete",
        results: [],
        codexThreadId: "thread_choice",
        lifecycle: {
          phase: "waiting_for_human",
          reason: "Choose the audience.",
        },
        availableActions: [],
        conversation: {
          turnStatus: "in_progress",
          archived: false,
          items: {},
          turnOrder: ["turn_choice"],
          activeTurnId: "turn_choice",
        },
      },
    ];
    value.product!.currentTaskId = "task_choice";
    value.product!.attention = [
      {
        authority: "codex",
        kind: "user_input",
        requestId: "question_choice",
        taskId: "task_choice",
        threadId: "thread_choice",
        turnId: "turn_choice",
        itemId: "item_choice",
        generation: 1,
        status: "pending",
        sequence: 1,
        title: "Choose the final audience",
        questions: [
          {
            id: "audience",
            header: "Audience",
            question: "Who should receive this update?",
            isOther: true,
            isSecret: false,
            options: [
              {
                label: "Leadership",
                description: "Concise executive update",
              },
              {
                label: "Product team",
                description: "More delivery detail",
              },
            ],
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );

    expect(html).toContain("task-choice-response");
    expect(html).toContain("Who should receive this update?");
    expect(html).toContain("task-response-index");
    expect(html).toContain("task-response-option-copy");
    expect(html).toContain("Concise executive update");
    expect(html).toContain('placeholder="Something else…"');
    expect(html).toContain(">Send</button>");
    expect(html).not.toContain("Leadership — Concise executive update");
    expect(html).not.toContain("task-composer-shell");
    expect(html).not.toContain("composer-ambient-controls");
    expect(html).not.toContain('aria-label="Commands"');
  });

  it("renders bounded keyboard-scroll regions for long task content", () => {
    const value = snapshot();
    value.product!.catalog.account = {
      status: "logged_in",
      authMode: "chatgpt",
    };
    value.product!.tasks = [
      {
        taskId: "task_long",
        executionMode: "agent",
        browserIdentity: { mode: "temporary" },
        selectionSource: "user_selected",
        selectedAt: "2026-09-08T00:00:00Z",
        approvalsReviewer: "auto_review",
        bootstrapStage: "complete",
        results: [],
        lifecycle: { phase: "working", reason: "Working." },
        availableActions: [],
        conversation: {
          turnStatus: "in_progress",
          archived: false,
          items: Object.fromEntries(
            Array.from({ length: 40 }, (_, index) => [
              `item_${index}`,
              {
                id: `item_${index}`,
                turnId: "turn_long",
                kind: "assistant_message" as const,
                status: "completed" as const,
                text: `Long conversation entry ${index} ${"detail ".repeat(40)}`,
              },
            ]),
          ),
          turnOrder: ["turn_long"],
          activeTurnId: "turn_long",
        },
      },
    ];
    value.product!.currentTaskId = "task_long";
    const html = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(html).toContain(
      '<section class="product-main product-main-task" aria-label="Task workspace" tabindex="0">',
    );
    expect(html).toContain(
      '<aside class="product-sidebar" aria-label="Task controls and status" tabindex="0">',
    );
    expect(html).toContain("Long conversation entry 39");
    expect(html).not.toContain('aria-label="Archive Untitled task"');
  });

  it("keeps messages and browser activity in one human-readable chronology", () => {
    const value = snapshot();
    value.product!.catalog.account = {
      status: "logged_in",
      authMode: "chatgpt",
    };
    value.product!.tasks = [
      {
        taskId: "task_timeline",
        executionMode: "agent",
        workflowAssociation: {
          workflowId: "workflow_updates",
          workflowName: "Weekly updates",
        },
        browserIdentity: { mode: "workspace", workspaceId },
        selectionSource: "user_selected",
        selectedAt: "2026-09-12T00:00:00Z",
        approvalsReviewer: "auto_review",
        bootstrapStage: "complete",
        results: [
          {
            resultId: "result_timeline",
            taskId: "task_timeline",
            turnId: "turn_timeline",
            kind: "draft",
            lifecycle: "prepared",
            selected: true,
            currentRevision: 2,
            revision: {
              resultId: "result_timeline",
              revision: 2,
              title: "Reviewed folder summary",
              body: "Use the reviewed folder list for the next turn.",
              artifactIds: [],
              digest: "f".repeat(64),
              createdAt: "2026-09-12T00:00:05.000Z",
            },
            source: {
              conversationItemId: "final",
              conversationTextDigest: "e".repeat(64),
              evidenceIds: [],
            },
            createdAt: "2026-09-12T00:00:05.000Z",
            updatedAt: "2026-09-12T00:00:06.000Z",
          },
          {
            resultId: "result_action",
            taskId: "task_timeline",
            turnId: "turn_timeline",
            kind: "action",
            lifecycle: "prepared",
            selected: false,
            currentRevision: 1,
            revision: {
              resultId: "result_action",
              revision: 1,
              title: "Send folder summary",
              body: "Prepared external update",
              artifactIds: [],
              digest: "a".repeat(64),
              createdAt: "2026-09-12T00:00:07.000Z",
            },
            source: {
              conversationItemId: "final",
              conversationTextDigest: "e".repeat(64),
              evidenceIds: [],
            },
            actionMaterial: {
              recipient: "ops@example.test",
              content: "The folder is organized.",
              target: "mailbox:ops",
              attachmentIds: [],
              scope: "one message",
            },
            materialDigest: "b".repeat(64),
            createdAt: "2026-09-12T00:00:07.000Z",
            updatedAt: "2026-09-12T00:00:07.000Z",
          },
        ],
        lifecycle: { phase: "working", reason: "Working." },
        availableActions: ["message", "finish"],
        attachments: [
          {
            id: `att_${"b".repeat(32)}`,
            filename: "rove-live-acceptance.txt",
            mimeType: "text/plain",
            size: 74,
            sha256: "e".repeat(64),
            status: "bound",
            taskId: "task_timeline",
            sessionId: "ses_timeline",
            evidenceId: "ev_timeline",
          },
        ],
        conversation: {
          turnStatus: "in_progress",
          archived: false,
          items: {
            user: {
              id: "user",
              turnId: "turn_timeline",
              kind: "user_message",
              authoredBy: "user",
              status: "completed",
              completedAt: "2026-09-12T00:00:00.000Z",
              attachments: [
                { filename: "rove-live-acceptance.txt", kind: "file" },
                { filename: "reference.png", kind: "image" },
              ],
              text: "Organize the Drive folder.",
            },
            inspect: {
              id: "inspect",
              turnId: "turn_timeline",
              kind: "tool",
              status: "completed",
              completedAt: "2026-09-12T00:00:00.500Z",
              title: "rove/browser.inspect",
            },
            commentary: {
              id: "commentary",
              turnId: "turn_timeline",
              kind: "assistant_message",
              authoredBy: "assistant",
              status: "completed",
              phase: "commentary",
              completedAt: "2026-09-12T00:00:00.750Z",
              text: "I found the requested folder.",
            },
            interact: {
              id: "interact",
              turnId: "turn_timeline",
              kind: "tool",
              status: "completed",
              completedAt: "2026-09-12T00:00:01.000Z",
              title: "rove/browser.interact",
            },
            continuation: {
              id: "continuation",
              turnId: "turn_timeline",
              kind: "user_message",
              authoredBy: "host",
              status: "completed",
              completedAt: "2026-09-12T00:00:02.000Z",
              text: "Continue after human control returned.",
            },
            resumed: {
              id: "resumed",
              turnId: "turn_timeline",
              kind: "assistant_message",
              authoredBy: "assistant",
              status: "completed",
              phase: "commentary",
              completedAt: "2026-09-12T00:00:03.000Z",
              text: "Control returned; I am checking Drive again.",
            },
            final: {
              id: "final",
              turnId: "turn_timeline",
              kind: "assistant_message",
              authoredBy: "assistant",
              status: "completed",
              phase: "final_answer",
              completedAt: "2026-09-12T00:00:04.000Z",
              text: [
                "## Result",
                "",
                "- The Drive folder is organized.",
                "- `Receipt` saved.",
                "- [x] Evidence retained",
                "",
                "| Item | Status |",
                "| --- | --- |",
                "| Folder | Ready |",
                "",
                "> Verified without repeating the action.",
                "",
                "~~Pending~~ Complete.",
                "",
                "[Drive](https://drive.google.com)",
                "",
                'ROVE_LIVE_RESULT {"status":"passed","count":2}',
              ].join("\n"),
            },
          },
          turnOrder: ["turn_timeline"],
          activeTurnId: "turn_timeline",
        },
      },
    ];
    value.product!.workflows = [
      {
        workflowId: "workflow_updates",
        name: "Weekly updates",
        archived: false,
        currentRevision: 1,
        revision: {
          workflowId: "workflow_updates",
          revision: 1,
          configuration: {
            purpose: "Prepare weekly updates",
            preferences: [],
            criteria: [],
            guidance: [],
            procedures: [],
            resourceRequirements: [],
            resultConventions: [],
            approvedKnowledge: [],
          },
          digest: "9".repeat(64),
          approvedAt: "2026-09-12T00:00:00Z",
        },
        createdAt: "2026-09-12T00:00:00Z",
        updatedAt: "2026-09-12T00:00:00Z",
      },
    ];
    value.product!.currentTaskId = "task_timeline";
    value.product!.recoveryWarnings = [
      "Codex event recovery: Task event identity was reused with different content.",
      "Codex event recovery: Task event identity was reused with different content.",
    ];

    const html = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(html).toContain('aria-label="Conversation and activity"');
    expect(html).toContain("Reading the current page");
    expect(html).toContain("Interacting with the page");
    expect(html).not.toContain("Structured progress");
    expect(html).not.toContain(">CODEX<");
    expect(html).toContain("Worked for 1s");
    expect(html).toContain(">Working for ");
    expect(html).toContain("The Drive folder is organized.");
    expect(html).toContain("<h2>Result</h2>");
    expect(html).toContain("<li>The Drive folder is organized.</li>");
    expect(html).toContain("<code>Receipt</code>");
    expect(html).toContain("<table>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<del>Pending</del>");
    expect(html).toContain('class="language-json"');
    expect(html).toContain("&quot;status&quot;: &quot;passed&quot;");
    expect(html).toContain('class="message-link"');
    expect(html).not.toContain('href="https://drive.google.com"');
    expect(html).not.toContain(
      "Codex event recovery: Task event identity was reused with different content.",
    );
    expect(html.match(/aria-label="Copy message"/g)).toHaveLength(2);
    expect(html.match(/aria-label="Copy response"/g)).toHaveLength(1);
    expect(html).not.toContain('aria-label="Task results"');
    expect(html).not.toContain("Working material for follow-up");
    expect(html).toContain('aria-label="Outputs used for this message"');
    expect(html).toContain("Using: Reviewed folder summary ×");
    expect(html).not.toContain('aria-label="Save response as result"');
    expect(html).not.toContain("Authorize exact action");
    expect(html).toContain(
      'aria-label="Open saved Output: Reviewed folder summary"',
    );
    expect(html).toContain("Saved to Outputs");
    expect(html).toContain("Organize the Drive folder</strong>");
    expect(html).toContain('aria-label="Sent attachments"');
    expect(html).not.toContain('aria-label="Current task attachments"');
    expect(html).not.toContain("74 bytes · bound");
    expect(html).toContain("rove-live-acceptance.txt");
    expect(html.indexOf("rove-live-acceptance.txt")).toBeLessThan(
      html.indexOf("Organize the Drive folder."),
    );
    expect(html.indexOf("Organize the Drive folder.")).toBeLessThan(
      html.indexOf("Reading the current page"),
    );
    expect(html.indexOf("Reading the current page")).toBeLessThan(
      html.indexOf("I found the requested folder."),
    );
    expect(html.indexOf("I found the requested folder.")).toBeLessThan(
      html.indexOf("Interacting with the page"),
    );
    expect(html.indexOf("Interacting with the page")).toBeLessThan(
      html.indexOf("Continue after human control returned."),
    );
    expect(html.indexOf("Continue after human control returned.")).toBeLessThan(
      html.indexOf("Control returned; I am checking Drive again."),
    );
    expect(html).toContain(
      'class="composer-input-shell followup task-composer-shell"',
    );
    expect(html).toContain('aria-label="Attach files"');
    expect(html).toContain('aria-label="Participation mode: Agent"');
    expect(html).toContain('aria-label="Approval policy: Approve for me"');
    expect(html).toContain('aria-label="Model and reasoning effort:');
    expect(html).toContain('aria-label="Stop task"');
    expect(html).not.toContain(">Pause</button>");
    expect(html).not.toContain("Finish task");
  });

  it("uses the same product component for keyboard-labeled chip, expanded, and full controls", () => {
    const chip = renderToStaticMarkup(
      <ProductSurface
        desktop={snapshot("chip")}
        connectionError={null}
        follower
        refresh={async () => undefined}
      />,
    );
    const expanded = renderToStaticMarkup(
      <ProductSurface
        desktop={snapshot("expanded")}
        connectionError={null}
        follower
        refresh={async () => undefined}
      />,
    );
    expect(chip).toContain('aria-label="Expand Rove. Not signed in to Codex"');
    expect(expanded).toContain("Go to Rove");
    expect(expanded).toContain('aria-label="Collapse Rove"');
  });

  it("keeps retained cleanup tasks actionable without presenting them as a global launch blocker", () => {
    const value = snapshot();
    value.product!.catalog.account = {
      status: "logged_in",
      authMode: "chatgpt",
    };
    value.product!.tasks = ["old", "new"].map((suffix) => ({
      taskId: `task_blocker_${suffix}`,
      executionMode: "agent" as const,
      browserIdentity: { mode: "temporary" as const },
      selectionSource: "user_selected" as const,
      selectedAt: "2026-09-08T00:00:00Z",
      approvalsReviewer: "auto_review" as const,
      bootstrapStage: "complete" as const,
      results: [],
      lifecycle: {
        phase: "cleanup_required" as const,
        reason: `Cleanup remains for ${suffix}.`,
      },
      availableActions: ["retry_cleanup" as const],
    }));
    value.product!.currentTaskId = "task_blocker_new";

    const html = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(html).toContain("Task needs attention");
    expect(html).toContain("Cleanup remains for new.");
    expect(html).not.toContain("must finish or converge");
    expect(html.match(/>Retry cleanup<\/button>/g)).toHaveLength(1);
  });

  it("exposes explicit acknowledgement when previous-work uncertainty blocks fresh effects", () => {
    const value = snapshot();
    value.product!.catalog.account = {
      status: "logged_in",
      authMode: "chatgpt",
    };
    value.product!.tasks = [
      {
        taskId: "task_legacy_effects",
        executionMode: "agent",
        browserIdentity: { mode: "workspace", workspaceId },
        selectionSource: "user_selected",
        selectedAt: "2026-09-10T00:00:00Z",
        approvalsReviewer: "auto_review",
        bootstrapStage: "complete",
        results: [],
        lifecycle: { phase: "ready", reason: "Ready." },
        availableActions: ["finish", "acknowledge_legacy_effects"],
        runtime: {
          status: "active",
          controller: "agent",
          attachment: "attached",
          recovery: "not_needed",
          profileOwnership: "owned",
          legacyEffects: "acknowledgement_required",
        },
      },
    ];
    value.product!.currentTaskId = "task_legacy_effects";

    const html = renderToStaticMarkup(
      <ProductSurface
        desktop={value}
        connectionError={null}
        follower={false}
        refresh={async () => undefined}
      />,
    );
    expect(html).toContain("Acknowledge previous-work uncertainty");
  });

  it("states that an explicit handoff response is needed in chip, expanded, and full presentations", () => {
    const render = (presentation: "chip" | "expanded" | "full") => {
      const value = snapshot(presentation);
      value.product!.catalog.account = {
        status: "logged_in",
        authMode: "chatgpt",
      };
      value.companion = {
        session: {
          id: "ses_explicit",
          mode: "agent",
          status: "active",
          controller: "agent",
        },
        observationCount: 1,
        evidenceCount: 0,
      };
      value.product!.tasks = [
        {
          taskId: "task_explicit",
          executionMode: "agent",
          browserIdentity: { mode: "temporary" },
          selectionSource: "user_selected",
          selectedAt: "2026-09-08T00:00:00Z",
          approvalsReviewer: "auto_review",
          bootstrapStage: "complete",
          results: [],
          roveSessionId: "ses_explicit",
          codexThreadId: "thread_explicit",
          lifecycle: {
            phase: "waiting_for_human",
            reason: "Your response is needed.",
          },
          availableActions: ["message", "finish"],
          runtime: {
            status: "active",
            controller: "agent",
            attachment: "attached",
            recovery: "not_needed",
            profileOwnership: "released",
          },
          conversation: {
            activeTurnId: "turn_explicit",
            turnStatus: "in_progress",
            archived: false,
            items: {},
            turnOrder: ["turn_explicit"],
          },
        },
      ];
      value.product!.currentTaskId = "task_explicit";
      value.product!.attention = [
        {
          authority: "rove_control",
          kind: "control_handoff",
          requestId: "control:ses_explicit:handoff_explicit",
          taskId: "task_explicit",
          threadId: "thread_explicit",
          turnId: "turn_explicit",
          generation: 4,
          status: "pending",
          sequence: 1,
          title: "Browser control handoff",
          continuationPolicy: "explicit_user_response",
        },
        {
          authority: "codex",
          kind: "mcp_elicitation",
          requestId: "form_datetime",
          taskId: "task_explicit",
          threadId: "thread_explicit",
          turnId: "turn_explicit",
          itemId: "item_datetime",
          generation: 4,
          status: "pending",
          sequence: 2,
          title: "Tool needs information",
          elicitation: {
            mode: "form",
            message: "Exact instant",
            fields: [
              {
                id: "instant",
                title: "Instant",
                required: true,
                type: "string",
                format: "date-time",
                default: "2026-09-08T12:34:56+01:00",
              },
            ],
          },
        },
      ];
      return renderToStaticMarkup(
        <ProductSurface
          desktop={value}
          connectionError={null}
          follower={presentation !== "full"}
          refresh={async () => undefined}
        />,
      );
    };
    const chip = render("chip");
    expect(chip).toContain("Reply");
    expect(chip).toContain("Your response is needed");
    expect(render("expanded")).toContain("Your response is needed");
    const full = render("full");
    expect(full).toContain("Your response is needed");
    expect(full).not.toContain("No action is needed from you right now.");
    expect(full).toContain('aria-label="Current task request"');
    expect(full).not.toContain('placeholder="Reply so the task can continue…"');
    expect(full).not.toContain("task-composer-shell");
    expect(full).toContain('value="2026-09-08T12:34:56+01:00"');
    expect(full).not.toContain('type="datetime-local"');
  });
});
