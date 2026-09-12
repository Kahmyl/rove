# Semantic move and drag experiment

Date: 2026-09-07

Status: completed; staged drag and destination-aware semantic transfers are implemented

## Trigger

The Google Drive live-acceptance journey successfully created folders,
uploaded a file, and renamed it, but could not move the file into the grounded
`Archive` folder. The Move command did not expose a usable successor dialog.
A grounded drag dispatched, but the file remained in its original folder and
the verified receipt was `not_applied`.

This investigation deliberately treats that result as a capability-boundary
failure rather than adding Google Drive selectors, timing, or page-state rules.

## Diagnosis

Rove's production `drag` path currently resolves two targets and calls
Playwright `locator.dragTo(source, destination)` once. Four distinct gaps sit
behind that apparently simple operation:

1. **Gesture mechanics:** the default call produces only one movement over the
   destination. Applications can require several pointer transitions, an
   activation threshold, dwell, or a visibly activated drop zone before
   release.
2. **Capability evidence:** Rove adds the `drag` capability only for an HTML
   `draggable` element. Applications can implement dragging entirely with
   pointer handlers on an ordinary row, button, or link.
3. **Action granularity:** `drag` is modeled as one opaque dispatch rather than
   `preflight -> engage -> advance -> activate -> release -> reconcile`. Runtime
   cannot inspect or safely cancel before the consequential release.
4. **Outcome semantics:** `target_absent` can show that an item left the current
   view, but cannot by itself prove that it entered the intended destination.
   Current receipts also expose no gesture-phase trace.

The accessible Move command is a separate multi-step workflow. Google Drive's
documented route opens the actions menu, enters the Organize submenu, activates
Move, chooses a folder, and commits with a second Move control. A single
activation does not represent that transaction.

## Research findings

- Playwright documents `dragTo` as hover, mouse-down, one move to the target,
  and mouse-up. It separately warns that pages relying on `dragover` require at
  least two moves over the drop target in all browsers.
- The HTML drag-and-drop processing model negotiates acceptance through
  `dragenter` and canceled `dragover` events, including `DataTransfer`
  `effectAllowed` and `dropEffect`, before `drop`.
- Script-created UI events are untrusted. A synthetic `DataTransfer` sequence
  can satisfy simple handlers but is not a general substitute for browser
  input and can be rejected by an application.
- ARIA's `aria-grabbed` and `aria-dropeffect` are deprecated and currently have
  no replacement, so accessibility metadata cannot be the sole drag signal.
- Google Drive officially supports three move routes: Move dialog,
  drag-to-folder, and Chrome keyboard cut/paste. The screen-reader path exposes
  the Move dialog as an explicit multi-step keyboard workflow.

Primary sources:

- <https://playwright.dev/docs/input#drag-and-drop>
- <https://playwright.dev/docs/api/class-locator#locator-drag-to>
- <https://html.spec.whatwg.org/multipage/dnd.html>
- <https://www.w3.org/TR/uievents/>
- <https://www.w3.org/TR/html-aria/#docconformance-deprecated>
- <https://support.google.com/drive/answer/2375091>
- <https://support.google.com/drive/answer/12169158>

## Isolated experiment

The executable experiment is
`packages/browser/src/experiments/drag-move-strategies.test.ts`. It compares
five strategies against:

- an HTML drag target requiring at least two `dragover` events;
- a pointer-driven target requiring movement plus 100 ms activation dwell;
- a keyboard cut/paste move workflow.

Every pointer event is measured for type and `isTrusted`. The experiment also
uses production perception to compare advertised capabilities.

| Strategy                    | HTML negotiated drop        | Custom pointer drop           | Event trust            |
| --------------------------- | --------------------------- | ----------------------------- | ---------------------- |
| Current default `dragTo`    | Fail; 1 `dragover`          | Fail; 1 pointer move          | Trusted                |
| `dragTo({ steps: 8 })`      | Pass; 3 `dragover`          | Fail; no activation dwell     | Trusted                |
| Staged pointer gesture      | Pass; 4 `dragover`          | Pass; threshold and dwell met | Trusted                |
| Synthetic `DataTransfer`    | Pass in simple HTML handler | Fail                          | Untrusted              |
| Semantic keyboard cut/paste | Not applicable              | Pass in keyboard workflow     | Browser keyboard input |

Production perception advertised `drag` for the HTML element but not for the
successfully draggable pointer application. The mechanical matrix passed once
normally and three times concurrently with identical results; the final
capability-augmented matrix then passed independently.

## Implemented Runtime upgrade

Rove now provides a verified multi-phase interaction executor and a generic
`transfer` semantic transaction above it.

The calling agent should retain semantic authority: it proposes “move this
grounded item to this grounded folder,” the expected outcome, and an observed
mechanism when one is explicit. Runtime should own the safe mechanics and
phase boundaries:

```text
fresh source + fresh destination + semantic intent + expected effects
                              |
                              v
 preflight -> engage -> progress -> activation check -> release -> reconcile
```

### First production slice

1. Replace the one-shot `locator.dragTo` implementation with a trusted staged
   pointer executor: source hover, mouse-down, threshold movement, bounded
   dwell, multi-step travel, repeated target movement, bounded activation
   observation, then mouse-up.
2. Derive all coordinates from the two freshly grounded targets. Do not expose
   coordinate selection or timing knobs to the agent.
3. Expand gesture-source evidence beyond `draggable=true`. Treat a requested
   semantic drag on a visible grounded control as a candidate, while recording
   whether evidence came from native drag metadata, role/row structure, or the
   caller's explicit task intent.
4. Add a pre-release cancellation boundary. If the target cannot be resolved
   or becomes stale, release over the source or cancel rather than committing
   somewhere uncertain.
5. Emit a bounded phase trace in the receipt: selected strategy, phases
   reached, source/destination authority, target activation evidence, release
   completion, and reconciliation result. Do not expose site event payloads.
6. Add destination-aware expected effects. For visible containers, support a
   grounded relation such as `target_within_scope`. For remote destinations,
   require independent confirmation evidence or a later destination
   inspection; source absence alone is insufficient.
7. Keep the existing consequence key and replay fence across the whole plan.
   After release, an unknown outcome must reconcile and must never trigger a
   second strategy automatically.

### Implemented follow-on slice

Agent-authored, Runtime-fenced semantic transactions now cover documented menu,
keyboard, drag, file-picker, and direct transfer mechanisms under one typed
lifecycle. The production fixtures qualify both local and remote menu
transfers. Each phase requires its own observation-scoped action, the commit is
consequential, and `unknown` is terminal.

The verifier has two explicit destination modes:

- `within_scope` proves the exact source target is nested within a currently
  visible, named destination scope;
- `destination_observation` proves the exact source target is present after the
  caller enters a remote destination and additionally requires independent
  destination-context evidence, such as the exact folder URL or breadcrumb.

Source disappearance alone never verifies a remote transfer. Additional
mechanisms still require their own qualification fixtures; they are never
hidden fallbacks after an uncertain commit.

### Live remote-destination result

The Drive acceptance run moved `rove-live-acceptance-renamed.txt` into the
`Archive` folder with applied commit receipt
`rcpt_69742d2abc0743689815bad244676734`. The source parent no longer contained
the item (`bobs_00e96bbda7824c96b05a536b1c064510`), and an independent
destination observation proved the exact row inside `Archive`
(`bobs_625043eaf46f46818e68a2ce77882060`).

The original transaction encoded `Archive` as a visible `list` scope, even
though Drive rendered the destination contents under a separate `Item List`
grid after navigation. That made transaction verification report
`not_applied` despite the successful move. The two destination modes above are
the generic correction: remote folders are verified from their own fresh
observation plus independent destination identity, not by guessing the web
application's eventual container role or label.

After deployment, a fresh task confirmed the two destination modes in the live
MCP catalog. Observation `bobs_5fff1622197e4503a75e73d1a0121b04`
independently proved the exact file row, `Archive` breadcrumb, and exact folder
URL. Download then applied exactly once (`rcpt_4a6200eb406047d29f2bc500b2fd274d`)
and produced managed file evidence
`ev_6af5afb25cb849109421120f07d9f562` (73 bytes). Final viewport evidence is
`ev_54414525f5a147c0a8063e3faeb0f1fe`.

### Explicitly rejected direction

Do not make synthetic `DragEvent`/`DataTransfer` dispatch the production
fallback. It produces untrusted events, bypasses real input semantics, and
failed the custom pointer surface in the experiment. Do not add Drive-specific
selectors or fixed delays.

## Production gate proposal

The upgrade should not ship until it passes:

- HTML drag/drop, pointer-threshold, nested-source, scroll-during-drag, and
  shadow/frame fixtures;
- stale source/destination and target-removal races at every phase;
- cancellation before release with no destination mutation;
- exactly-once release and no alternative strategy after unknown outcome;
- destination-aware verification, not only source disappearance;
- repeated GitHub, Gmail/Calendar, Maps, and PDF non-regression journeys;
- the Drive move journey with a newly created disposable artifact.

The completed repository gate passed all 124 test files and all 755 tests in a
serial privileged run, in addition to typecheck, lint, formatting, and the
production build.
