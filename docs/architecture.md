# Architecture baseline

The deterministic browser safety and human-handoff contract is documented in
[browser-safety-orchestration.md](./browser-safety-orchestration.md).

```text
DEPLOYED CONTROL PLANE                    USER'S ROVE HUB

External MCP client                      Electron Companion
        │                                        │
        ▼                                        ▼
    apps/mcp ──> cloud API/relay <== outbound Hub link ==> apps/runtime
                                                               │  │
                                                               ▼  ▼
                                                         browser storage
```

The desktop package contains the Companion, Runtime, browser support, and local
storage only. It never starts or packages an MCP server and never generates MCP
credentials. `apps/mcp`, the future public backend API, and the future web UI
belong to the deployed control plane.

The cloud API/relay and authenticated outbound Hub link shown above are not yet
production-ready. The repository now contains a production-shaped local slice:

- `apps/control-plane` owns an in-memory device command queue and result routing;
- the Companion starts an optional outbound-only Hub connector after its local
  Runtime becomes ready;
- MCP selects a control-plane-backed `RuntimeClient` when
  `ROVE_CONTROL_PLANE_URL` is configured;
- versioned command envelopes live in `@rove/protocol` and cover the complete
  MCP-to-Runtime command surface.

The local relay deliberately uses long polling and development pre-shared
tokens. Before production it requires durable command storage, explicit
delivery/acknowledgement semantics, device enrollment, per-device credentials,
key rotation, revocation, horizontal routing, rate limits, and audit policy.
The direct Runtime HTTP adapter remains an explicit development fallback, not
the target production topology.

### Desktop product home

Desktop state has a single launch-independent location. By default the native
Companion resolves it from Electron's stable per-user application-data base as
`Rove/product`. Source and packaged launches use the same resolver; repository
cwd, the generic `ROVE_HOME` used by Runtime/CLI workflows, and Electron's
mutable Chromium `--user-data-dir` do not participate. Qualification may set
`ROVE_DESKTOP_HOME`, but only to an absolute path. This Desktop-only override
has precedence over the canonical default and is rejected when relative.

The product home owns Runtime state, browser workspace identities, Phase 5 task
state, and Rove's isolated Codex account home. An ordinary Codex installation's
login is not imported or represented as Rove authentication. This is a
pre-release boundary correction, so historical cwd-relative homes are not
automatically migrated: Rove does not copy credentials or browser profiles
from them. A user signs in to Rove with ChatGPT in the canonical product home,
and that Rove-owned login is then available to later source and packaged
launches using the same home.

Docker Compose follows the same boundary: it contains `apps/control-plane` and
`apps/mcp` only. The Companion, outbound Hub connector, Runtime, browser binary,
profiles, and evidence storage stay on the host. MCP exposes separate liveness
(`/live`) and Hub-readiness (`/health`) checks so server containers can start
while a user's Hub is offline.

## Invariants encoded by the skeleton

1. Runtime state is authoritative; neither MCP nor Electron owns it.
2. A session has at most one controller.
3. Capture mode begins under human control; agent and companion modes begin under agent control.
4. Agent mutation is rejected unless the agent owns control.
5. Observations are append-only and use a monotonic per-session sequence.
6. Human-to-agent handback invalidates browser references through a revision change.
7. Protocol, browser, storage, and config packages import no application adapter.
8. The packaged Runtime binds to loopback; its generated credential protects local session routes and is never presented as an MCP credential.
9. Evidence paths are generated below the Rove home directory.
10. Sensitive typed values are represented only by redacted metadata.

## Browser implementation

The browser package currently implements:

- a real headed Playwright Chromium/Chrome browser lifecycle with durable selected workspaces and explicitly requested temporary identities;
- one BrowserContext per BrowserSession;
- stable `page_01`, `page_02`, ... page identities and active-page management;
- navigation with material page revision updates;
- one canonical browser observation containing bounded visible text, redacted Playwright ARIA hierarchy, viewport/scroll/device-scale state, and existing Runtime perception metadata;
- deterministic accessible-name approximation and target classification;
- open-shadow-aware target discovery with frame provenance, Playwright geometry, clipping, and basic hit-test occlusion evidence;
- sensitivity detection through the existing `isSensitiveTarget()` contract;
- revision-scoped `tN` target references backed by one current TargetRegistry per page;
- centralized action-time target resolution with page/revision, marker, semantic identity, visibility, enabled, and interactivity validation;
- material DOM mutation tracking that preserves safe references across unrelated changes and invalidates missing/replaced targets;
- `click`, sequential-key `type` for normal-sized input, targeted/page `press`, viewport `scroll`, `back`, and `forward`;
- viewport, full-page, target, and viewport-relative region PNG screenshots with sensitive-field masking across frames/open shadow roots, durable evidence, exact-observation validation, and bounded MCP image presentation;
- popup discovery and shared post-action page/revision synchronization;
- normalized human browser activity for navigation, titles, meaningful interaction, form submission, fixed scroll milestones, selections, page creation, and page switching;
- browser-level Chromium tab reconciliation using CDP `tab` target `embedderData.tabActive`, mapped back to stable Rove page IDs without persisting CDP target identity;
- deterministic local fixture tests and headed manual verification.

MCP defaults new sessions to the workspace selected in Rove. A task may name only an existing opaque workspace ID or explicitly request a temporary identity; task start never creates storage. Runtime applies a conservative minimum action interval in headed mode, while the browser uses configurable sequential key timing.

The browser workspace is durable Rove-owned identity, not a Runtime or task
session. Cookies, site storage, service workers, and ordinary site
preferences survive browser close. A separate browser-host record proves the
single writable Chrome process using a host ID, nonce, process start identity,
profile identity, loopback CDP endpoint, Runtime instance, session, and
ownership generation. A dead Runtime may reconnect to a verified live host with
a fresh page registry and fresh target authority. A concurrent active Runtime
receives `PROFILE_LOCKED`; stale owned metadata is removed only after liveness
and identity checks. Profile deletion remains an explicit operation, and Rove
never substitutes a temporary profile unless the caller requested one.

Phase 5 recovery keeps one persisted task authority across Desktop, Runtime,
App Server, and renderer restarts. Runtime inventory distinguishes attachment,
profile ownership, and recovery from persisted session status. Close advances
through durable requested, Codex-settled, continuation-settled, Runtime-settled,
and complete stages; restart resumes the first unfinished stage without
replaying a browser session, Codex thread, user turn, or continuation. Terminal
named-workspace cleanup may remove only a lock proven claimable from a dead
owner. The source-built recovery qualification is documented in
[the P5.9 L2 report](./experiments/2026-09-08-phase5-p59-l2-production-recovery.md).

Page-state handling is split into three explicit layers:

```text
browser perception
      ↓
Runtime page-state policy
      ↓
explicit Runtime orchestration
```

The browser package reports observational page-state perception and propositions only. Runtime evaluates that perception into an internal `PagePolicyDecision` for orchestration and compatibility. Agent-facing MCP `browser.inspect` returns the perception together with `metadata.actionAuthority`; it does not return the deprecated page-wide mutation verdict and never changes session ownership. Only explicit session-start and post-action orchestration boundaries may translate internal policy into an automatic control transition.

Authentication and presented human verification may automatically request human control for Agent and Companion sessions. Access restriction, page errors, and loading/unstable states never automatically transfer ownership. An unfamiliar interstitial is observational evidence; contextual per-action authority may still permit freshly grounded recovery, navigation, reversible UI, or explicitly authorized verifiable task work. Capture Mode remains human-owned. Explicit `control.request_human` remains available when the agent judges human assistance useful.

The architecture explicitly excludes fingerprint spoofing, automation concealment, proxy rotation, CAPTCHA solving, and other access-control evasion. Rove cannot promise that a third-party site will permit automation, even when the task itself is legitimate.

Inspection does not increment page revision. Existing revision authority remains the document/target freshness boundary. `BrowserObservation` additionally binds revision to URL, material mutation version, viewport, scroll position, and device scale so visual capture can reject stale observations without introducing a second page-version counter.

## Runtime integration

The runtime owns the `ses_*` identity and maps each active session to one browser session. Startup persists `starting` before launch and transitions to `active` or `failed`; shutdown closes the browser before persisting `completed`. Browser-changing operations pass through the per-session command coordinator and agent-control guard. Runtime action results expose the Rove session ID, observations never persist raw typed values, and screenshot bytes are converted to filesystem evidence.

Action truth is bounded at mutation dispatch. Failure before dispatch remains a
definite action failure. Once dispatch may have occurred, failure is an
`ACTION_OUTCOME_UNKNOWN` replay fence unless the browser confirms completion.
When dispatch completed but successor synchronization, inspection, expected
effect evidence, policy recording, or receipt persistence degrades, the
`ActionReceipt` preserves the completed dispatch and reports the degradation
separately. Consequential unknown outcomes are never recommended for blind
replay; inspection is required to reconcile them.

Multi-step dynamic workflows use semantic transactions above the primitive
interaction layer. The caller declares a grounded source, named destination,
observed mechanism, expected effects, and one consequence identity. Runtime
requires a fresh observation for each later phase, makes `commit` the only
consequential boundary, and makes `uncertain` terminal without trying another
mechanism. A visible destination is verified by exact membership within its
grounded scope. A remote destination is verified only after entering it, with
exact source-target presence plus independent destination context such as its
URL or breadcrumb. Transaction state and audit-persistence degradation are
exposed through the private HTTP API, MCP, and outbound Hub command surface.
For keyboard clipboard transfers, an effect-free copy/cut prepare may advance
on trusted completed dispatch only after the supplied fresh observation proves
the exact source is selected. The receipt remains honest about its unobservable
page outcome; the source-bound paste is still the sole consequential boundary.
Agent-facing observation targets may be presentation-limited, while Runtime
grounding and effect verification read the canonical target authority retained
for the observation. A `targetsTruncated` response therefore cannot turn a
visibly verified effect into an unresolved transaction solely because of the
agent presentation budget.

Each Companion, MCP, Control Plane, and managed Runtime publishes a bounded
component identity: component kind, instance and process identity, package
version, start time, stable build identity, supported Runtime/Hub protocols,
and a development commit when safely discoverable. A production route is
selected by protocol and build compatibility; it never depends on a Git commit.
A controlled development environment may additionally configure an expected
development commit, in which case every repository-built component and the
selected Runtime must match it. MCP health distinguishes its own identity from
the Control Plane, Companion, and selected Runtime identities.

Browser-host identity and session generation link browser authority to the
selected Runtime. The Control Plane rejects missing or malformed provenance,
fails immediately when no live compatible Runtime owns a route, and permits a
new instance to replace a live one only when their build identities and
development commits agree. `startedAt` is a lifecycle tie-breaker within that
compatible build, never a substitute for compatibility. Companion records restricted ownership
metadata and only replaces an orphaned managed Runtime after the record,
process-start identity, command marker, loopback health response, PID, and
Runtime instance all agree. Unknown processes are never attached to or killed.

The private NestJS API exposes local session, browser, page, observation, and evidence routes. It is the Hub's private Runtime API, not the future deployed product API. A centralized bearer guard protects session routes when configured, non-loopback startup without a token is rejected, and structured Rove errors are mapped to stable HTTP responses.

Control state is persisted on the session and validated centrally for Agent, Companion, and Capture modes. Requested handoff removes agent ownership before a human takes control; Companion may also take control voluntarily. Returning control synchronizes the active page and invalidates every page target registry before restoring agent ownership. Durable control-transition observations drive an in-process, lost-wakeup-safe wait service using query, waiter registration, and a second query rather than polling. Human take and return remain private runtime operations consumed by the Electron Companion.

Browser activity is actor-neutral at the browser boundary. Runtime persistence assigns actor `human` only while the persisted session is active and human-controlled. Capture Mode therefore records the human journey without allowing the activity channel to misclassify agent-owned browser execution. Human interaction payloads are minimized before persistence and do not contain raw typed values.

## Electron companion

The Electron main process starts and supervises only the local Runtime. It owns local Runtime connectivity and authentication, discovers the current active Companion or Capture Mode session through the private runtime API, and retrieves session state, observations, and evidence without routing through MCP. MCP process lifecycle and MCP credential generation are outside the desktop boundary.

The renderer runs with `contextIsolation=true`, `nodeIntegration=false`, and sandboxing enabled. A CommonJS preload exposes only the narrow `window.rove` API for snapshot retrieval, Take Control, Return Control, and Finish Session.

The renderer presents session, mode, controller, status, observation count, and evidence count. Requested human handoffs surface their persisted reason in the desktop UI. Human-to-agent return continues to use the runtime control state machine, including all-page target invalidation before agent ownership is restored. Capture Mode remains human-owned, exposes no usable take/return transition, and may be completed from the Companion.

## Implementation slices

- Phase 1 browser lifecycle, semantic inspection, safe actions, and stale-target protection are implemented.
- Phase 2 runtime/browser integration, lifecycle persistence, evidence, observations, and the private HTTP API are implemented.
- Phase 3/4 MCP tools, stdio, authenticated Streamable HTTP, and runtime HTTP adaptation are implemented.
- Phase 7 runtime control protocol, exclusive-control state machine, private HTTP operations, durable waits, stale-target handback, and the agent-facing MCP tools `control.status`, `control.request_human`, and `control.wait` are implemented. Human take/return are not exposed through MCP.
- Phase 8 Electron Companion, secure preload bridge, runtime session discovery, control UI, handoff presentation, and session completion are implemented.
- Phase 9 human activity observation instrumentation, minimized Capture Mode persistence, real human tab-switch observation, Capture discovery in Companion, mutation blocking, and read-only MCP access are implemented.
