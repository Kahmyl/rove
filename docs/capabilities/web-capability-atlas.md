# Rove Web Capability Atlas

Date: 2026-09-07

Status: Wave 0 inventory and the first cohesive Wave 1–5 production tranche are
complete; remaining capability families stay explicitly gated in the atlas

## Decision

Rove will stop using live application journeys as its primary capability
discovery mechanism. Live journeys remain release validation, but capability
discovery and qualification move to a maintained Web Capability Atlas backed by
isolated adversarial fixtures.

The intended maximum is not every site-specific widget or workflow. That set is
unbounded. The intended maximum is:

- standardized browser and HTML interaction primitives;
- the common composite-widget contracts defined by WAI-ARIA and APG;
- recurring custom interaction mechanisms such as pointer drag, virtualized
  collections, canvas surfaces, rich editing, and file transfer;
- browser-owned and security-sensitive surfaces with an explicit human boundary;
- every applicable stage from perception through safety, rather than an action
  method alone.

The machine-readable inventory is
[web-capability-atlas.json](./web-capability-atlas.json). It currently contains
84 capability families across eight domains. Each entry contains a seven-stage
maturity vector in this order:

    perception -> grounding -> action -> verification -> evidence -> recovery -> safety

An entry is not production-supported merely because Playwright can dispatch an
input event. Production support requires the whole applicable chain.

## Current baseline

The audit found:

| Measure                                       | Count |
| --------------------------------------------- | ----: |
| Capability families                           |    84 |
| Fully covered across every applicable stage   |    31 |
| At least one partial stage                    |    52 |
| At least one missing stage                    |    14 |
| Already proven only in an isolated experiment |     1 |
| Explicit human-boundary families              |     7 |

Rove's current protocol exposes 23 target kinds, 18 target capabilities, 12
structural scope kinds, 20 verified interactions, and 27 expected-effect forms.
The observation contract
also advertises the exact interaction vocabulary, semantic-state keys, atlas
version, and six explicit human boundaries.

The first production tranche closed the original structural gap through one
shared implementation:

1. A centralized capability registry maps DOM and ARIA evidence to truthful
   mechanism-level capabilities.
2. Distinct kinds now represent switches, comboboxes, listboxes, sliders,
   spinbuttons, tree items, grid cells, rows, disclosures, and media controls.
3. Revision-scoped target state now includes focus, expansion, press, selection,
   current, busy, invalid, required, readonly, open, value bounds and text,
   orientation, popup, controls, and active-descendant relationships. Sensitive
   text values remain omitted.
4. The verified action union now includes double, secondary, and modified click,
   focus and blur, targeted or page keypress, one-request sequential typing,
   text selection, clipboard shortcuts, and evidence-backed multi-file upload.
5. Trusted drag uses bounded pointer engage, threshold, dwell, interpolation,
   release, and synchronization phases. Receipts carry the phase trace, while
   unknown post-commit outcomes still stop without fallback dispatch.

The most important remaining gaps are capability-family qualification, not a
new architecture:

1. Full APG keyboard matrices and malformed variants for every composite widget.
2. Download-lifecycle effects and the remaining specialized scope variants.
3. Directory upload, rich-text structure, IME composition, and media controls.
4. Drag autoscroll, pan, and touch/multi-pointer gestures.
5. Provider-specific detection and handoff qualification for browser-owned UI.

## Research basis

The inventory is derived from primary specifications and the official browser
automation API, not from a list of sites:

- The [HTML Standard](https://html.spec.whatwg.org/) defines native controls,
  forms, dialogs, popovers, media, editing hosts, navigation, and drag and drop.
- [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/) defines widget roles,
  states, properties, relationships, and focus semantics.
- The [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/patterns/)
  supplies more than 30 recurring composite-widget keyboard and state contracts.
- [Input Events Level 2](https://www.w3.org/TR/input-events-2/),
  [UI Events](https://www.w3.org/TR/uievents/), the
  [Selection API](https://www.w3.org/TR/selection-api/), and
  [Clipboard API](https://www.w3.org/TR/clipboard-apis/) define editing,
  composition, selection, key, and clipboard behavior.
- [Pointer Events](https://www.w3.org/TR/pointerevents3/) and
  [CSSOM View](https://www.w3.org/TR/cssom-view-1/) define pointer capture,
  multi-pointer input, scrolling, geometry, and visual viewport behavior.
- [Permissions](https://www.w3.org/TR/permissions/),
  [WebAuthn](https://www.w3.org/TR/webauthn-3/), and
  [Payment Request](https://www.w3.org/TR/payment-request/) establish surfaces
  where express user choice or verification is part of the platform contract.
- The official [Playwright actions](https://playwright.dev/docs/input) and
  [actionability](https://playwright.dev/docs/actionability) documentation
  defines the trusted mechanics and preconditions available to Rove.
- [web-platform-tests](https://web-platform-tests.org/) is the upstream
  cross-browser conformance corpus. Rove should reuse or adapt relevant cases
  where possible instead of inventing all platform fixtures independently.

## Baseline and production qualification

The executable baseline is
packages/browser/src/experiments/capability-atlas-baseline.test.ts. It uses
production target discovery, classification, and perceived-control logic, then
compares that semantic surface with trusted Playwright operations.

The pre-upgrade baseline observed:

| Surface                       | Browser mechanic           | Pre-upgrade Rove representation            | Result                                         |
| ----------------------------- | -------------------------- | ------------------------------------------ | ---------------------------------------------- |
| Native details and summary    | Primary click              | Summary is not a candidate                 | Browser pass; perception gap                   |
| Pointer-only item             | Double click               | No interaction kind and no candidate       | Browser pass; protocol and perception gap      |
| Pointer-only item             | Secondary click            | No interaction kind and no candidate       | Browser pass; protocol and perception gap      |
| Date, range, and color inputs | Typed fill                 | All collapse to fill on input              | Browser pass; typed state and verifier gap     |
| ARIA slider                   | Arrow key changes value    | Generic control with hover and scroll only | Browser pass; semantic capability gap          |
| ARIA switch                   | Click changes aria-checked | Generic control with check and uncheck     | Mechanic covered; kind and state model partial |
| Dialog descendant             | Scoped button action       | Dialog scope is perceived                  | Current scope path passes                      |

This demonstrated that the browser engine was not the primary blocker for these
families. The missing layer was the protocol that describes, selects, phases,
and verifies the correct mechanism.

The previously completed drag experiment remains the baseline for multi-phase
gestures:
[2026-09-07-semantic-move-and-drag.md](../experiments/2026-09-07-semantic-move-and-drag.md).
It proved that a staged trusted pointer gesture deterministically satisfies the
tested thresholds, while one-shot timing is environment-dependent and synthetic
drag events are not a general solution.

The admitted production path is qualified by
`packages/browser/src/playwright-browser-actions.test.ts`,
`apps/runtime/src/interaction/verified-interaction.test.ts`, and
`apps/mcp/src/tools/browser.tools.test.ts`. The semantic transaction path adds
`packages/protocol/test/semantic-transaction.test.ts`,
`apps/runtime/src/interaction/semantic-transaction-store.test.ts`, and the
Runtime service and HTTP integration fixtures. The combined fixtures verify all three
activation variants, focus/blur, targeted keypress and numeric state,
one-request sequential typing, selection, copy/cut/paste shortcut dispatch,
multi-file upload, native disclosure state, switch state, HTML drag-and-drop,
custom pointer drag, phase receipts, protocol exposure, sensitive-value
redaction, and a menu-based transfer with fresh grounding at every phase, one
explicit commit, destination membership verification, and terminal replay
refusal. Run the complete tranche with `pnpm browser:capability-waves`; run the
focused transaction gate with `pnpm browser:semantic-transactions`.

## Production architecture

The atlas now leads to one internal capability registry, not a growing set of
site adapters. As the remaining rows are admitted, each capability descriptor
should provide:

- the semantic evidence that makes the capability eligible;
- required provider features;
- an action-plan factory with explicit phases and commit boundary;
- actionability preconditions;
- typed expected effects and a verifier;
- bounded evidence emitted by each phase;
- stale-state, cancellation, and unknown-outcome behavior;
- consequence class and human-control policy;
- fixture and live-journey qualification references.

The calling agent remains the decision-maker. It selects the semantic intent,
grounded entities, expected outcome, and any mechanism that the page explicitly
offers. Rove validates that the proposed mechanism is supported and owns safe
execution mechanics. Rove must not infer a site workflow, silently select an
alternative mechanism after an uncertain commit, or turn the registry into a
site-specific policy engine.

Two different abstractions are required:

1. Interaction primitives operate one control or gesture: click, focus, set a
   value, select an option, drag, scroll, or press a key.
2. Semantic transactions compose current observations and primitives under one
   consequence identity: move an item, submit a form, accept a suggestion, or
   choose a folder and commit.

Conflating these levels caused the Drive Move failure: one menu activation was
treated as if it represented the complete move transaction, while a one-shot
drag was treated as if dispatch implied destination membership.

## Experiment waves

### Wave 0 — inventory and protocol truth

Status: complete.

- Freeze the current protocol vocabulary in the atlas.
- Fail tests if protocol enums and the inventory diverge.
- Prove representative browser mechanics independently of Rove.
- Record missing, partial, experimental, human-only, and intentionally
  inapplicable stages separately.

### Wave 1 — P0 semantic completeness

Status: shared state/action/verifier contract and representative production
fixtures complete. Managed download completion now has an action-correlated,
evidence-backed expected effect; broader download progress/cancel lifecycle,
destination scope, and the remaining specialized input matrix stay gated by
their atlas rows.

Add adversarial fixtures for:

- complete ARIA state and relationship acquisition;
- native summary and details;
- input subtype metadata and typed value verification;
- focus and blur;
- double, secondary, and modified click;
- single-request sequential typing and keyboard shortcuts;
- value, focus, expanded, pressed, selected, dialog, download progress/failure,
  and
  target-within-scope expected effects.

Production admission continues by capability family after its fixture passes.

### Wave 2 — composite widgets

Status: semantic kinds, states, relationships, and mechanism primitives are in
production. Exhaustive APG widget and malformed-contract matrices remain.

Use APG-conformant and deliberately malformed fixtures for combobox/listbox,
menus, tabs, radio groups, sliders, spinbuttons, trees, grids, treegrids,
dialogs, disclosures, popovers, and virtualized collections. Qualify both mouse
and keyboard routes when the widget contract requires them.

The Runtime should expose state and relationships; it should not hide an entire
widget workflow behind one opaque action.

### Wave 3 — multi-phase gestures and transfer

Status: the trusted staged pointer executor and phase evidence are in production
for HTML and custom pointer drag. A generic semantic transaction state machine
is also in production for transfer workflows. Autoscroll, pan, touch, and
additional semantic transaction kinds remain gated.

Build the verified multi-phase interaction executor already supported by the
drag experiment. Cover HTML drag, pointer drag, threshold, dwell, pointer
capture, autoscroll, pan, reordering, cancellation, stale geometry, and
destination-aware verification.

No alternate strategy may run automatically after an uncertain release or
commit. A semantic transaction is begun from a freshly grounded source and
named destination, advances prepare and commit actions from new observations,
and performs a separate final destination-scope verification. The consequence
key spans the whole transaction; `uncertain` is terminal.

### Wave 4 — editing, clipboard, files, and media

Status: sequential typing, whole-target text selection, keyboard clipboard
operations, and multiple-file upload are in production. Directory upload,
rich-text/IME, deeper download lifecycle, and media remain gated.

Qualify contenteditable, selection, rich-text structure, IME composition,
autocomplete, undo/redo, multiple and directory uploads, clipboard
transactions, download lifecycle, and media state.

Sensitive input and clipboard content must stay outside ordinary observations
and evidence.

### Wave 5 — browser-owned and human-owned boundaries

Status: the machine-readable observation contract explicitly reports permission,
WebAuthn, payment, human-verification, closed-shadow, and browser-owned-UI
boundaries. Reliable human handoff remains the intended behavior; each provider
surface still requires qualification.

Qualify detection and handoff for permission prompts, password-manager and OTP
surfaces, passkeys, CAPTCHA, payment sheets, print preview, fullscreen, and
other browser-owned UI. The expected production result for many of these is a
reliable human boundary, not agent automation.

## Admission gates

A capability can move to production only when all of the following are true:

1. Its semantics and browser mechanics are tied to a primary specification or
   official provider contract.
2. Conformant, malformed, stale, hidden, covered, replaced, frame, shadow, and
   relevant virtualized variants have been tested.
3. Managed Chromium and attached system Chrome follow the same Rove authority
   and evidence contract.
4. The action has a typed expected effect; dispatch success alone cannot pass.
5. Consequential actions have a stable consequence key and exactly-once
   reconciliation behavior.
6. Cancellation before commit leaves no unintended mutation.
7. Unknown after commit stops the plan and never activates a fallback.
8. Evidence is bounded, correlated to current session/page/revision, and
   redacts sensitive values.
9. Human takeover invalidates pre-handoff targets and resumes with a fresh
   observation.
10. Existing unit, integration, E2E, package, and representative live journeys
    remain green.

## Operating model

The atlas is a living engineering ledger:

- New failures first map to an existing capability family. A new family is
  added only when the mechanism is genuinely distinct.
- Site-specific selectors, fixed delays, and special-case page rules are not
  capability fixes.
- Each production pull request updates the relevant pipeline cells and links
  qualifying fixtures.
- A scheduled standards review should compare HTML, ARIA/APG, Playwright, and
  web-platform-tests changes with the atlas.
- Live journeys validate composition and ecosystem integrity; they do not
  redefine the primitive contract.

This boundary gives Rove broad coverage without asking Rove itself to decide
what every website means. The agent decides intent; the capability registry
makes the available mechanics truthful, safe, and verifiable.
