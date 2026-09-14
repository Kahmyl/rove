export const UI_TRUTH_VIEWPORTS = Object.freeze({
  product: Object.freeze({ width: 1180, height: 780 }),
  compactProduct: Object.freeze({ width: 590, height: 650 }),
  followerMicro: Object.freeze({ width: 64, height: 56 }),
  followerExpanded: Object.freeze({ width: 360, height: 240 }),
  followerLarge: Object.freeze({ width: 760, height: 420 }),
});

function scenario({
  id,
  name,
  category,
  fixture,
  applicationTruth,
  rendererTruth,
  semanticAssertions,
  negativeAssertions,
  viewports = ["product"],
  screenshot = true,
  trace = false,
}) {
  return Object.freeze({
    id,
    name,
    category,
    fixture,
    applicationTruth: Object.freeze([...applicationTruth]),
    rendererTruth: Object.freeze([...rendererTruth]),
    semanticAssertions: Object.freeze([...semanticAssertions]),
    negativeAssertions: Object.freeze([...negativeAssertions]),
    viewports: Object.freeze([...viewports]),
    screenshot,
    trace,
  });
}

export const UI_TRUTH_SCENARIOS = Object.freeze([
  scenario({
    id: "T01",
    name: "no-task-new-task",
    category: "tasks",
    fixture: "task.none",
    applicationTruth: [
      "No task is selected or executing.",
      "The product remains ready to accept a new task.",
    ],
    rendererTruth: [
      "The new-task composer is the primary task surface.",
      "No execution controls are projected for a nonexistent task.",
    ],
    semanticAssertions: [
      'A "Desired outcome" control is available.',
      'A "Start task" action is available when required setup is valid.',
    ],
    negativeAssertions: [
      "The UI must not imply that a task or browser session is already running.",
      "The UI must not show failure merely because task history is empty.",
    ],
  }),

  scenario({
    id: "T02",
    name: "task-working",
    category: "tasks",
    fixture: "task.working",
    applicationTruth: [
      "The selected task has an active/in-progress turn.",
      "Execution remains task-scoped.",
    ],
    rendererTruth: [
      "The task projects an in-progress/working state.",
      "A Stop action is available for the executing task.",
    ],
    semanticAssertions: [
      "The active task visibly communicates that work is in progress.",
      "The executing task exposes its Stop action.",
    ],
    negativeAssertions: [
      "The UI must not imply completion while the turn is active.",
      "The UI must not imply that all other tasks are blocked.",
    ],
    trace: true,
  }),

  scenario({
    id: "T03",
    name: "turn-completed-conversation-usable",
    category: "tasks",
    fixture: "task.completed",
    applicationTruth: [
      "The latest turn completed.",
      "The durable task conversation remains usable for follow-up.",
    ],
    rendererTruth: [
      "No active-turn Stop control is projected.",
      "Follow-up input remains available.",
    ],
    semanticAssertions: [
      "Completed task history remains visible.",
      "The user can continue the same conversation.",
    ],
    negativeAssertions: [
      "The UI must not imply that completion permanently closes the conversation.",
      "The UI must not require creating a new task merely to follow up.",
    ],
    trace: true,
  }),

  scenario({
    id: "T04",
    name: "task-interrupted-follow-up-available",
    category: "tasks",
    fixture: "task.interrupted",
    applicationTruth: [
      "The turn was interrupted/stopped.",
      "The task itself remains durable and resumable.",
    ],
    rendererTruth: [
      "The active execution state is cleared.",
      "A continuation/follow-up path remains available.",
    ],
    semanticAssertions: [
      "The task visibly communicates that execution stopped or was interrupted.",
      "The same task remains usable afterward.",
    ],
    negativeAssertions: [
      "Stop must not be represented as task deletion or permanent closure.",
      "The UI must not claim the interrupted turn completed successfully.",
    ],
    trace: true,
  }),

  scenario({
    id: "T05",
    name: "task-failed",
    category: "tasks",
    fixture: "task.failed",
    applicationTruth: ["The authoritative task/turn outcome is failed."],
    rendererTruth: [
      "The failure state is visible.",
      "Any available recovery/follow-up action is distinct from success.",
    ],
    semanticAssertions: ["A task failure is communicated clearly to the user."],
    negativeAssertions: [
      "Assistant prose must not override authoritative failure truth.",
      "The UI must not visually present the task as completed successfully.",
    ],
  }),

  scenario({
    id: "T06",
    name: "task-needs-attention",
    category: "tasks",
    fixture: "task.attention",
    applicationTruth: [
      "One exact task has pending attention requiring user input or approval.",
    ],
    rendererTruth: [
      "Attention is projected on the owning task.",
      "The attention request exposes its task-specific controls.",
    ],
    semanticAssertions: [
      "The owning task has a visible attention indication.",
      "The attention request is reachable from that task.",
    ],
    negativeAssertions: [
      "Attention on one task must not imply every task is blocked.",
      "The currently viewed task must not inherit another task's attention request.",
    ],
  }),

  scenario({
    id: "T07",
    name: "task-a-running-task-b-viewed",
    category: "tasks",
    fixture: "task.active-a-viewed-b",
    applicationTruth: [
      "Task A remains the executing task.",
      "Task B is the currently viewed task.",
      "UI selection is not execution authority.",
    ],
    rendererTruth: [
      "Task B content is rendered in the main viewed-task surface.",
      "Task A retains its running indication in task navigation/status.",
      "Task B controls are derived from Task B rather than Task A.",
    ],
    semanticAssertions: [
      "Task B history/content is visible.",
      "Task A remains visibly identified as running.",
    ],
    negativeAssertions: [
      "Task B must not display Task A's Stop/browser/control actions as its own.",
      "Viewing Task B must not transfer Task A's execution or browser ownership.",
    ],
    trace: true,
  }),

  scenario({
    id: "T08",
    name: "standalone-task-without-workflow",
    category: "tasks",
    fixture: "task.standalone",
    applicationTruth: [
      "The task has no Workflow association.",
      "Standalone work is first-class.",
    ],
    rendererTruth: ["The task remains fully usable without Workflow context."],
    semanticAssertions: [
      "The standalone task conversation and relevant task actions remain available.",
    ],
    negativeAssertions: [
      "The UI must not imply that a Workflow is required to use a task.",
      "The absence of a Workflow must not be rendered as an error.",
    ],
  }),

  scenario({
    id: "W01",
    name: "no-workflows",
    category: "workflows",
    fixture: "workflow.none",
    applicationTruth: ["The local Workflow collection is empty."],
    rendererTruth: [
      "A useful empty state and Workflow creation path are projected.",
    ],
    semanticAssertions: ["The user can discover how to create a Workflow."],
    negativeAssertions: [
      "An empty Workflow collection must not be represented as a load failure.",
    ],
  }),

  scenario({
    id: "W02",
    name: "task-associated-with-workflow",
    category: "workflows",
    fixture: "workflow.associated",
    applicationTruth: [
      "The task carries an explicit Workflow association.",
      "The association identifies a concrete Workflow name/id/revision context.",
    ],
    rendererTruth: [
      "The task/Workflow relationship is visible where relevant.",
    ],
    semanticAssertions: [
      "The associated Workflow can be identified from the task experience.",
    ],
    negativeAssertions: [
      "The UI must not imply that task history itself is portable Workflow configuration.",
    ],
  }),

  scenario({
    id: "W03",
    name: "workflow-revision-advanced",
    category: "workflows",
    fixture: "workflow.revised",
    applicationTruth: [
      "The Workflow has advanced to a newer immutable revision.",
    ],
    rendererTruth: [
      "Current Workflow editing surfaces reflect the current revision.",
    ],
    semanticAssertions: [
      "The current Workflow configuration is visible after revision advancement.",
    ],
    negativeAssertions: [
      "The UI must not silently rewrite historical task truth as if it always used the latest revision.",
    ],
  }),

  scenario({
    id: "W04",
    name: "save-reusable-material-to-workflow",
    category: "workflows",
    fixture: "workflow.promote",
    applicationTruth: [
      "One exact user-selected task item/result revision is eligible for explicit Workflow promotion.",
    ],
    rendererTruth: [
      "Promotion identifies the selected reusable material and destination Workflow.",
    ],
    semanticAssertions: [
      "An Add-to-Context action is available for qualifying material.",
      "The promotion UI identifies what will be saved.",
    ],
    negativeAssertions: [
      "Conversation content must not become reusable Workflow knowledge automatically.",
      "Promotion must not grant new permissions, credentials, or action authority.",
    ],
    trace: true,
  }),

  scenario({
    id: "R01",
    name: "result-produced",
    category: "results",
    fixture: "result.produced",
    applicationTruth: [
      "The task owns structured results using domain kinds: finding_collection, draft, report, journey, artifact, or action.",
    ],
    rendererTruth: [
      "The current result is represented as a customer-facing Output from authoritative result state.",
    ],
    semanticAssertions: [
      "The produced Output is visible and inspectable from its Workflow.",
    ],
    negativeAssertions: [
      "Structured result truth must not be replaced solely by free-form assistant prose.",
    ],
  }),

  scenario({
    id: "R02",
    name: "result-selected-revised",
    category: "results",
    fixture: "result.selected-revised",
    applicationTruth: [
      "The result has an authoritative current revision.",
      "Its selected flag reflects current task follow-up context.",
    ],
    rendererTruth: [
      "The current Output content is shown without exposing revision mechanics.",
      "Selection state matches the domain flag in follow-up context.",
    ],
    semanticAssertions: [
      "The revised Output content is visible.",
      "Selection state is visibly distinguishable.",
    ],
    negativeAssertions: [
      "An obsolete result revision must not be shown as current.",
      "Selection must not imply external-action authorization.",
    ],
    trace: true,
  }),

  ...["prepared", "authorized", "dispatched", "confirmed", "unresolved"].map(
    (lifecycle, index) =>
      scenario({
        id: `A0${index + 1}`,
        name: `consequential-action-${lifecycle}`,
        category: "results",
        fixture: `action.${lifecycle}`,
        applicationTruth: [
          `The authoritative consequential action lifecycle is ${lifecycle}.`,
        ],
        rendererTruth: [
          `The renderer translates the ${lifecycle} lifecycle into its distinct customer-facing status without collapsing it into a generic sent/done state.`,
        ],
        semanticAssertions: [
          `The UI communicates consequential-action state ${lifecycle}.`,
        ],
        negativeAssertions: [
          ...(lifecycle === "prepared"
            ? ["Prepared must not imply authorization, dispatch, or success."]
            : []),
          ...(lifecycle === "authorized"
            ? ["Authorized must not imply dispatch or confirmation."]
            : []),
          ...(lifecycle === "dispatched"
            ? ["Dispatched must not imply successful effect confirmation."]
            : []),
          ...(lifecycle === "confirmed"
            ? [
                "Confirmed must not be represented as unresolved or merely pending.",
              ]
            : []),
          ...(lifecycle === "unresolved"
            ? [
                "Unresolved must not imply that the action definitely failed.",
                "Unresolved must not suggest that blind retry is safe.",
              ]
            : []),
        ],
        trace: true,
      }),
  ),

  scenario({
    id: "B01",
    name: "browser-absent-task-healthy",
    category: "collaboration",
    fixture: "browser.absent",
    applicationTruth: [
      "The task exists and is healthy without an attached browser capability.",
    ],
    rendererTruth: [
      "Browser-dependent actions are unavailable or invite attachment as appropriate.",
      "Ordinary task interaction remains healthy.",
    ],
    semanticAssertions: ["The task surface remains usable without a browser."],
    negativeAssertions: [
      "Browser absence must not be rendered as task failure.",
      "The UI must not imply a browser is already attached.",
    ],
  }),

  scenario({
    id: "B02",
    name: "browser-attached",
    category: "collaboration",
    fixture: "browser.attached",
    applicationTruth: [
      "The task has an attached task-owned browser page group.",
    ],
    rendererTruth: [
      "Browser/collaboration controls are projected for the owning task.",
    ],
    semanticAssertions: [
      "The task can expose its browser surface or applicable browser controls.",
    ],
    negativeAssertions: [
      "The selected/viewed task must not gain another task's browser ownership.",
    ],
  }),

  scenario({
    id: "C01",
    name: "agent-mode",
    category: "collaboration",
    fixture: "collaboration.agent",
    applicationTruth: ["The Runtime resource is agent-controlled."],
    rendererTruth: [
      "Agent-mode participation and valid takeover affordances are represented.",
    ],
    semanticAssertions: [
      "Agent participation is distinguishable from human-owned control.",
    ],
    negativeAssertions: [
      "Merely viewing another surface must not transfer control.",
    ],
  }),

  scenario({
    id: "C02",
    name: "companion-takeover-human-control",
    category: "collaboration",
    fixture: "collaboration.human-control",
    applicationTruth: [
      "Runtime has authoritatively transferred the relevant resource to the human.",
    ],
    rendererTruth: [
      "Human ownership is shown only after authoritative transfer.",
    ],
    semanticAssertions: [
      "The UI visibly communicates human control.",
      "A return-control action is available where supported.",
    ],
    negativeAssertions: [
      "The UI must not claim human control before Runtime confirms takeover.",
      "Conflicting agent mutation must not appear available as though control never changed.",
    ],
    trace: true,
  }),

  scenario({
    id: "C03",
    name: "return-control-to-agent",
    category: "collaboration",
    fixture: "collaboration.returned",
    applicationTruth: [
      "Control has been returned and fresh post-return truth has been reconciled.",
    ],
    rendererTruth: [
      "Agent control is restored from fresh state rather than stale pre-takeover assumptions.",
    ],
    semanticAssertions: [
      "The UI no longer reports human ownership after successful return.",
    ],
    negativeAssertions: [
      "The renderer must not reuse stale pre-takeover target/control truth.",
    ],
    trace: true,
  }),

  scenario({
    id: "C04",
    name: "capture-mode",
    category: "collaboration",
    fixture: "collaboration.capture",
    applicationTruth: [
      "Capture Mode is human-led.",
      "Capture Mode does not inherently require an active Codex turn.",
    ],
    rendererTruth: [
      "Capture participation is distinct from Agent working state.",
    ],
    semanticAssertions: [
      "Capture Mode is visibly identified as human-led participation.",
    ],
    negativeAssertions: [
      "Capture Mode must not imply that an agent turn is necessarily running.",
    ],
    trace: true,
  }),

  ...[
    ["V01", "recording-active", "recording", "recording.active"],
    ["V02", "recording-finalizing", "finalizing", "recording.finalizing"],
    ["V03", "recording-available", "available", "recording.available"],
    ["V04", "recording-failed-interrupted", "failed", "recording.failed"],
  ].map(([id, name, lifecycle, fixture]) =>
    scenario({
      id,
      name,
      category: "recording",
      fixture,
      applicationTruth: [
        `The authoritative task-page recording lifecycle is ${lifecycle}.`,
      ],
      rendererTruth: [`The renderer preserves recording state ${lifecycle}.`],
      semanticAssertions: [
        `The recording UI visibly communicates ${lifecycle}.`,
      ],
      negativeAssertions: [
        ...(id === "V01"
          ? [
              "Active page recording must not imply retroactive coverage.",
              "Page recording must not be advertised as browser-window recording.",
            ]
          : []),
        ...(id === "V02"
          ? [
              "Finalizing must not expose a playable/saved recording as though publication already succeeded.",
            ]
          : []),
        ...(id === "V03"
          ? [
              "Playable/Open recording state must only appear for an available artifact.",
            ]
          : []),
        ...(id === "V04"
          ? [
              "Failed/interrupted recording must not be advertised as a playable saved video.",
            ]
          : []),
      ],
      trace: true,
    }),
  ),

  scenario({
    id: "D01",
    name: "backup-export-success",
    category: "data-management",
    fixture: "backup.success",
    applicationTruth: [
      "The device-local export completed successfully.",
      "The export does not establish restore support.",
    ],
    rendererTruth: [
      "Export success is shown without inventing restore capability.",
    ],
    semanticAssertions: ["Successful export feedback is visible."],
    negativeAssertions: [
      "Backup success must not imply that restore is implemented.",
    ],
    trace: true,
  }),

  scenario({
    id: "D02",
    name: "backup-export-failure-cancel",
    category: "data-management",
    fixture: "backup.failure",
    applicationTruth: [
      "The export failed or was cancelled before a successful backup result existed.",
    ],
    rendererTruth: [
      "Failure/cancellation is distinguishable from export success.",
    ],
    semanticAssertions: ["The user receives truthful non-success feedback."],
    negativeAssertions: [
      "The UI must not claim a backup exists after failure/cancellation.",
    ],
    trace: true,
  }),

  scenario({
    id: "D03",
    name: "restore-unsupported",
    category: "data-management",
    fixture: "backup.restore-unsupported",
    applicationTruth: [
      "The local backup manifest contract has restoreSupported=false.",
    ],
    rendererTruth: ["No working Restore action is projected."],
    semanticAssertions: [
      "If restore is mentioned, it is clearly represented as unsupported.",
    ],
    negativeAssertions: [
      "The UI must not expose or imply a functioning Restore operation.",
    ],
  }),
]);

export const UI_TRUTH_SCENARIO_BY_ID = new Map(
  UI_TRUTH_SCENARIOS.map((item) => [item.id, item]),
);

export const REQUIRED_UI_TRUTH_SCENARIO_IDS = Object.freeze([
  "T01",
  "T02",
  "T03",
  "T04",
  "T05",
  "T06",
  "T07",
  "T08",
  "W01",
  "W02",
  "W03",
  "W04",
  "R01",
  "R02",
  "A01",
  "A02",
  "A03",
  "A04",
  "A05",
  "B01",
  "B02",
  "C01",
  "C02",
  "C03",
  "C04",
  "V01",
  "V02",
  "V03",
  "V04",
  "D01",
  "D02",
  "D03",
]);
