# Adaptive Browser Execution and Reconciliation

**Status:** Active implementation plan  
**Authority:** Derived from the Product Direction and browser/capability engineering contracts. This document sequences work; it does not override those contracts or claim implementation.

## Why this work exists

Rove already has strong browser foundations: task-owned page groups, exact task/page authority, fresh target grounding, structural perception, screenshots, human takeover/return, consequence identities, durable receipts/effect journals, dispatch-versus-outcome separation, and replay fencing.

Manual use exposed a different class of problem. The browser can execute an authorized mutation correctly yet fail to establish the intended outcome because the reasoning agent is asked to choose low-level verification predicates whose evidence limits are specific to Rove's current observation representation.

The September 2026 Google Drive acceptance journey is the motivating regression case. Before the folder-creation commit, the page observation already reported truncated page text and truncated target exposure. The consequential action was nevertheless verified with whole-page text presence. Dispatch completed and Runtime correctly fenced replay, but the effect remained unresolved because the chosen proof could not be authoritative over the truncated observation.

The desired correction is not a Google Drive rule. It is a cohesive browser execution model that normally works on an unfamiliar web application without engineering that application specifically.

## Settled direction

The target browser relationship is:

```text
User intent
    ↓
Codex reasoning
    ↓
Adaptive browser capability
    ├── perceive current state
    ├── choose a grounded interaction
    ├── dispatch through authority/safety checks
    ├── inspect the resulting state
    ├── escalate perception when evidence is insufficient
    ├── reconcile uncertain effects through read-only work
    └── request human participation at a genuine boundary
    ↓
Outcome truth
    ├── confirmed
    ├── not applied / failed
    └── genuinely unresolved
```

The existing authority and safety kernel remains underneath:

```text
Task/page ownership
Grants and approvals
Fresh grounding
Consequence identity
Single-dispatch boundary
Replay fencing
Durable receipts and evidence
Service/security policy
```

Adaptive execution is an orchestration responsibility inside the browser capability. It is **not** a second autonomous agent framework and does not replace Codex as the reasoning engine.

## Principles

1. **Outcome-oriented reasoning.** Codex should reason primarily about what must become true for the user's task, rather than programming low-level verification predicates as though they were application semantics.
2. **Progressive perception.** Prefer structured/semantic state when sufficient, then deepen observation only when evidence or coverage requires it.
3. **Known incompleteness is actionable information.** Truncation, target limits, ambiguous structure, stale state, and insufficient visual context should influence the next observation strategy before dispatch and during reconciliation.
4. **Mutation and reconciliation are separate.** A consequential effect may be dispatched once and remain unverified while read-only reconciliation continues.
5. **No uncertainty replay.** Reconciliation never repeats the consequential mutation, changes transport to disguise a retry, or widens authorization.
6. **Evidence can come from a different read surface than the commit surface.** The authoritative place to prove an outcome may be a refreshed list, search result, detail view, history/activity surface, persisted download evidence, or another permitted observation.
7. **Visual perception complements structure.** Screenshots/vision are ordinary escalation tools when structure is inadequate; they are not a last-resort website-specific patch.
8. **General capability correction over site rules.** Keep regression cases from real applications, but repair reusable perception/action/reconciliation families.
9. **Truth over apparent progress.** A successful click is not a confirmed external effect; incomplete evidence remains incomplete.
10. **Preserve the good foundations.** Page ownership, scoped coordination, approval binding, consequence identity, durable receipts, and replay fencing are retained unless contrary evidence emerges.

## Documentation impact

The canonical documentation has been reconciled before implementation:

- Product Direction defines adaptive browser quality and read-only reconciliation.
- Platform Policy distinguishes mutation replay from evidence gathering.
- Product Operating Model clarifies Checking outcome versus Outcome unclear.
- Logical Domain Model treats reconciliation as part of operation truth.
- System Architecture places adaptive browser execution above low-level Runtime primitives.
- Application and Capability Contracts define outcome-oriented browser reconciliation.
- Browser Control and Recording defines progressive perception and post-dispatch reconciliation.
- Structured Results and Actions keeps customer action state tied to evidence rather than low-level predicates.
- Events and Live State carries reconciliation without adding a second lifecycle authority.
- Testing and Operations requires cross-application and reconciliation qualification.
- Implementation Status records the current browser gap as partial until evidence closes it.

Documents whose existing boundaries remain valid do not need speculative edits: workflow portability, provider choice, local data portability, recording scope, and repository convergence.

## Established current implementation map

The read-only source audit at the current documentation baseline established the existing ownership seams before implementation work begins.

| Responsibility                                   | Current owner / path                                                                                | Disposition                                                                                                                                                                                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task-level reasoning and browser-route choice    | Codex through the task-bound MCP tool surface and `browser-route-policy.ts`                         | **Move responsibility selectively.** Codex should keep task reasoning and grounded action choice, but should not have to program Rove-specific proof mechanics.                                                                                       |
| Agent-facing browser contract                    | `apps/mcp/src/tools/browser.tools.ts`                                                               | **Generalize.** It currently exposes `expectedEffects` and detailed verifier advice directly to Codex, then passes those predicates through to Runtime.                                                                                               |
| Structured perception                            | `packages/browser` inspection/perception pipeline plus `browser.inspect`                            | **Keep and reuse.** Observations already expose semantic hierarchy, geometry, frame provenance, page-state facts, coverage/truncation, and freshness authority.                                                                                       |
| Visual perception primitive                      | `browser.screenshot` backed by the browser/Runtime evidence path                                    | **Keep and orchestrate.** Viewport, full-page, target, and region capture already exist and can be bound to an observation. The missing work is automatic evidence-strategy selection, not screenshot acquisition.                                    |
| Target grounding and stale-observation authority | `packages/browser` observation authority, target registry/resolution, Runtime interaction policy    | **Keep.** Current page/revision/mutation/viewport authority and stale-target refusal are safety foundations.                                                                                                                                          |
| Action authorization and dispatch                | Runtime interaction policy, ownership/coordinator boundaries, `browser.interact`                    | **Keep.** Runtime remains the single mutation authority.                                                                                                                                                                                              |
| Immediate effect verification                    | `apps/runtime/src/interaction/verified-interaction.ts`                                              | **Keep as a low-level evidence mechanism.** Causal transition rules and truncation-aware refusal correctly avoid false success.                                                                                                                       |
| Short asynchronous settlement                    | `RuntimeService.interact` bounded successor-reinspection loop                                       | **Generalize rather than duplicate.** Ordinary interactions already wait and re-inspect after dispatch without redispatch, but they repeatedly evaluate the same caller-selected `expectedEffects` against essentially the same observation strategy. |
| Durable external-effect truth / replay fencing   | Runtime effect journal plus consequence replay fence                                                | **Keep and extend only as needed.** This is already the authority that prevents duplicate consequential effects and stores outcome/evidence references.                                                                                               |
| Specialized later verification                   | semantic transaction begin/advance/verify/store                                                     | **Reuse/converge.** Transfer transactions already support a later fresh observation and explicit verification after commit, but the model is specialized and still expected-effect driven.                                                            |
| Generic process-cut reconciliation               | task-engine command classifications, worker `execute/reconcile`, `read_truth` / `correlate_receipt` | **Reuse as an engineering pattern, not as a second browser lifecycle.**                                                                                                                                                                               |
| Customer action lifecycle                        | Companion Result/action projection and renderer                                                     | **Keep.** Prepared/authorized/dispatched/confirmed/failed/unresolved remains the product truth projection; stronger browser evidence should settle the same action rather than create another lifecycle.                                              |

### Corrected diagnosis

Ordinary `browser.interact` is **not** missing all post-dispatch reconciliation. Runtime already performs bounded delayed successor inspections after a dispatched action and never redispatches the operation during that loop.

The missing capability is **adaptive outcome/evidence strategy**:

- the caller currently selects low-level `expectedEffects`;
- the MCP contract teaches Codex when to choose page text, exact targets, scopes, URLs, and other verifier primitives;
- Runtime can wait for the application to settle, but it keeps re-evaluating the same proof contract;
- when the proof contract itself is unsuitable for the observation — for example whole-page text on a known-truncated virtualized surface — waiting longer cannot make that proof authoritative;
- screenshots, target coverage, scoped grounding, other read-only browser routes, and specialized later verification already exist as separate primitives, but no cohesive ordinary-interaction layer chooses among them to settle the intended outcome.

Therefore this work should **extend and compose the existing interaction/receipt/effect-journal path**, not add a parallel reconciliation engine.

The motivating Drive case remains a regression for this gap: the safe Runtime machinery correctly refused false certainty and duplicate dispatch, while the browser execution layer failed to adapt its proof strategy to observation limits.

## Work sequence

### 1. Establish the browser execution map

**Status:** Complete for the current implementation baseline. The ownership map above satisfies this investigation gate and corrects the earlier assumption that ordinary interactions lacked any post-dispatch reconciliation.

Produce a code-level map from agent request through MCP, Runtime dispatch, observation, effect verification, journal persistence, and customer action projection.

Classify each responsibility as:

- reasoning/orchestration;
- authority/safety;
- perception;
- action execution;
- evidence persistence;
- outcome reconciliation;
- presentation.

The output of this investigation should identify where low-level verification planning currently leaks into Codex-facing behavior.

**Stop condition:** the team can trace an ordinary reversible interaction, a consequential mutation, and a semantic transaction end to end without guessing which component owns outcome truth.

### 2. Define the outcome/reconciliation contract

**Status:** Complete for the current implementation baseline.

The smallest coherent contract extends the existing authorities rather than introducing a second reconciliation entity or lifecycle.

- **Intended outcome / verification basis:** consequential work must durably bind the verification basis that was in force at dispatch. Task-result plans already retain their expected effects; ordinary consequential journal records currently do not retain the full effect parameters, so this is the one missing durable input. The implementation may initially normalize the existing expected-effect contract internally, but the durable basis must be immutable for that dispatched effect so later reconciliation cannot silently change the success criteria.
- **Dispatch truth:** the original `ActionReceipt` remains an immutable fact about the mutation attempt, its dispatch status, immediate successor evidence, and initial outcome. Later reconciliation must not rewrite that receipt.
- **Durable consequence truth:** the versioned Runtime effect journal remains the evolving authority for the external effect. Its existing immutable version chain already preserves history and task/workspace/consequence identity; no second durable reconciliation record is required.
- **Immediate evidence:** the initial receipt/observation/evidence records remain append-only evidence. Their failure to prove the outcome does not authorize redispatch.
- **Reconciliation state:** an unresolved journal record is the durable safety state while bounded read-only reconciliation is permitted. Active “Checking outcome” work may be projected as live state; a crash can safely fall back to durable unresolved without implying replay authority.
- **Terminal settlement:** add a constrained read-only settlement path that can move the same exact unresolved journal record to `applied` or `not_applied` using fresh authoritative evidence and optimistic journal versioning. Do not broaden the generic update path into arbitrary state rewriting.
- **Replay fence:** after terminal journal settlement is durably committed, the exact in-memory consequence fence must no longer remain stale for that key. It must never be cleared before durable settlement.
- **Customer projection:** keep the existing Result/action lifecycle. It already permits `unresolved → confirmed | failed`, and the Companion already projects Runtime effect truth into that lifecycle. Stronger later evidence should therefore settle the existing Output rather than create another customer-visible state machine.

The current effect journal's immutable version files already provide settlement history, so an embedded reconciliation-history array is unnecessary by default. Additional read attempts can remain ordinary observation/evidence records; the terminal journal version needs only authoritative settlement provenance sufficient to correlate the final truth.

The original ordinary interaction receipt persists effect kinds and states but not the full expected-effect parameters. An action fingerprint alone is not a recoverable verification contract. Therefore later adaptive reconciliation must not infer success criteria from a consequence-key string, model prose, or the current page. The verification basis must be bound before the mutation crosses the dispatch boundary.

The contract is:

```text
immutable verification basis
        +
single-dispatch ActionReceipt
        ↓
versioned EffectJournalRecord
        ↓
applied | not_applied | unresolved
                       ↓
            bounded read-only reconciliation
                       ↓
          same effect record, next version
                 applied | not_applied
                       ↓
             existing Result projection
              confirmed | failed
```

No durable `reconciling` state is required for correctness. If reconciliation is interrupted, `unresolved` is the safe restart truth: mutation remains fenced, unrelated work remains usable, and later authorized read-only evidence may continue settlement.

**Stop condition met:** an ordinary browser mutation can remain safely non-repeatable while later read-only evidence is allowed to settle the same durable external-effect identity.

### 3. Make perception adaptive

**Status:** Investigation and the focused page-text escalation slices are complete for the current implementation baseline. Broader adaptive perception remains open.

The audit shows that perception is not broadly missing. Existing primitives are already substantial:

- inspections expose text/target truncation and detailed target-coverage metadata;
- the browser retains a canonical registered target set behind presentation-limited `targetLimit` output;
- `resolveTarget` and `readObservation` can use those canonical targets even when the agent-facing inspection exposes only a subset;
- page-state perception already distinguishes readiness, instability, authentication, human verification, access restrictions, and other hard boundaries;
- bounded scroll/history/navigation reads already exist;
- screenshot capture already supports viewport, full-page, target, and region modes, can bind to an exact observation authority, persists durable evidence, and is returned through an image-capable MCP tool result.

The missing capability is **evidence suitability and read-strategy selection**. Runtime currently learns that text or target evidence was inadequate only inside post-dispatch expected-effect verification. There is no general pre-dispatch check that asks whether the selected proof surface can authoritatively establish the intended effect.

The audit also establishes an important distinction:

- **target presentation truncation is not necessarily target-evidence loss.** The PageInspector registers the full canonical eligible target set before slicing the agent-facing presentation. Internal `readObservation`/target resolution can therefore recover target truth without increasing the model-visible target list.
- **text truncation is actual observation loss.** The stored observation contains only bounded extracted text. Runtime can now recover one exact visible-text proposition through an internal observation-bound focused read without claiming that arbitrary page text is complete. Raising the global text budget remains neither necessary nor a scalable replacement for focused evidence.

Do not solve this by indiscriminately raising text/target limits. Larger agent-visible observations increase context cost and still fail on sufficiently large or virtualized surfaces.

#### Slice 3A — evidence suitability gate and canonical target verification

**Implemented.** Runtime now distinguishes the bounded target presentation from an authoritative canonical-target view. `readObservation()` marks that view complete only when the canonical registry exists, target acquisition reported no errors, and every semantic interactive control is represented in the semantic outcome partition. Total registered-target count does not contribute to that semantic completeness decision, so unrelated non-semantic targets cannot conceal a semantic discovery gap. Successor verification re-reads the inspected observation through that authority, so presentation-only `targetLimit` truncation does not make exact target effects unresolved while actual acquisition uncertainty still does.

Before consequential dispatch, a pure suitability assessment rejects whole-page `text_present` and `text_absent` effects when predecessor text is missing or truncated. The verifier independently treats missing or truncated predecessor/successor text as unresolved rather than authoritative absence. The existing `INSPECTION_REQUIRED` error includes the unsuitable effect, incomplete `page_text` surface, `mutationDispatched: false`, and the requirement for stronger read-only evidence. This occurs before effect-journal preparation or browser mutation dispatch; complete predecessor text continues through the existing authorization, receipt, causal-verification, and replay-fencing path.

Deterministic evidence is in `packages/browser/src/playwright-browser-inspection.test.ts`, `apps/runtime/src/interaction/verified-interaction.test.ts`, and `apps/runtime/src/runtime.integration.test.ts`. It covers canonical targets behind a presentation limit, production-path semantic incompleteness remaining unresolved despite an unrelated non-semantic registered target, missing and truncated whole-page text remaining unavailable for proof, pre-dispatch refusal with zero mutation/journal/receipt effects, the complete-text path, and the existing delayed one-dispatch reconciliation behavior.

The implemented slice is:

1. Reuse the canonical target registry for Runtime verification. A successor returned by `inspect` may be presentation-limited, so Runtime should obtain the authoritative observation for verification rather than treating `targetsTruncated` alone as loss of canonical target truth.
2. Represent whether the authoritative target set is complete enough for absence/presence proof separately from whether the agent-facing target presentation was truncated. Acquisition errors or unaccounted semantic controls must remain uncertainty.
3. Add a pure expected-effect evidence-suitability assessment before consequential dispatch. Page-text effects backed by a missing or known-truncated predecessor must be classified as requiring stronger evidence instead of being allowed to cross the mutation boundary and deterministically become unresolved.
4. Use the existing pre-dispatch `INSPECTION_REQUIRED` boundary with structured details for this first slice rather than inventing another error/lifecycle. It must be provably pre-dispatch and safe to follow with read-only perception work.
5. Preserve all existing action authorization, target freshness, consequence identity, replay fencing, and effect-journal behavior.

Required regression evidence for Slice 3A:

- a presentation-limited target list can still verify an exact target effect from canonical target evidence when target acquisition itself is complete;
- target acquisition errors/incompleteness do not get upgraded to certainty;
- a consequential `text_present`/`text_absent` request whose predecessor text is missing or truncated is refused before mutation dispatch;
- the same verification remains admissible when its predecessor text is complete;
- the motivating Drive-shaped failure therefore cannot dispatch with a proof surface Rove already knows is incapable of establishing the effect.

Slice 3A deliberately does **not** automate screenshot interpretation or add a new browser planner.

#### Slice 3B — focused read escalation

**Implemented for whole-page visible-text predicates.** The browser session now provides an internal observation-bound exact-text read rather than a new Codex-facing tool. It applies the same visible-text normalization and frame composition as ordinary inspection, checks all frames that ordinary page-text inspection considers, and returns only `present`, `absent`, or `unknown` with bounded frame diagnostics and observation provenance. Positive evidence remains valid when an unrelated frame read fails; negative evidence becomes `unknown` unless every relevant frame was read successfully.

The read validates the referenced observation before and after acquisition, retains page/revision/mutation/URL/viewport authority, and rejects frame-set or frame-navigation changes during acquisition through the existing stale/page-changed error model. It does not return the complete page text across the BrowserSession boundary.

Runtime deduplicates exact text propositions within one interaction. When predecessor text is missing or truncated, it obtains focused evidence before consequential journal preparation or dispatch; only authoritative focused truth permits the existing causal verifier to continue. An `unknown` proposition preserves the Slice 3A `INSPECTION_REQUIRED` result with no mutation, journal, or receipt. After dispatch, incomplete successor text triggers the same focused read immediately and on every bounded delayed successor inspection. Reconciliation never redispatches the mutation, and focused evidence remains proposition-scoped rather than changing `metadata.textTruncated` or fabricating a complete observation.

Deterministic evidence covers truncated and omitted predecessor text, unknown pre-dispatch refusal, truncated successor verification, partial-frame positive and negative semantics, pre-existing text remaining non-causal, delayed single-dispatch settlement, complete-text fast paths, inspected-frame inclusion, and stale observation refusal.

This slice does not prove logical absence outside the rendered page-text surface. Virtualized or off-rendered content, visual-only evidence, authoritative alternate views, broader targeted structure, and screenshot interpretation remain later perception strategies.

Existing `resolveTarget`, structural scopes, scrolling, navigation, and screenshot/vision should be composed before adding overlapping primitives.

Use observation metadata as control input rather than diagnostics only.

Beyond this focused slice, the browser capability must still respond to:

- text predicates that cannot be settled from the current rendered surface;
- truncated/excluded targets;
- virtualized or off-screen content;
- ambiguous semantic structure;
- asynchronous loading/busy state;
- state visible only in another page region or view;
- structural evidence insufficient for visual-only controls.

Candidate escalation mechanisms include canonical target reads, focused inspection, scroll/search, fresh observation after settling, screenshot/vision, and read-only navigation to an authoritative view.

The implementation should choose the cheapest reliable evidence route; no mandatory paid perception service is introduced.

**Stop condition:** known observation incompleteness can cause a deliberate perception escalation instead of silently producing a verification predicate the observation cannot prove.

### 4. Reduce verifier programming in the Codex-facing contract

Review the agent-facing browser tools and instructions. Preserve exact grounding and authorization inputs that the model genuinely must supply, but move implementation-specific verification selection behind the browser capability where possible.

The agent may still provide outcome information when it materially improves correctness. It should not have to understand that, for example, a whole-page text predicate becomes unusable whenever Rove's own page-text representation is truncated.

Compatibility can be maintained temporarily while old and new paths coexist, but there must be one authority for dispatch/outcome truth.

**Stop condition:** representative tasks can be expressed in outcome terms without Codex manually selecting brittle proof primitives for every consequential interaction.

### 5. Generalize post-dispatch reconciliation

Focused whole-page text evidence now composes with the existing bounded post-dispatch successor-reinspection path. Generalize the same no-redispatch model for other evidence strategies when repeating the original expected-effect check cannot establish the intended outcome.

Reconciliation may:

- fresh-inspect;
- wait for bounded convergence;
- inspect a target/scope;
- search or navigate to a read-only authoritative view;
- use screenshot/visual evidence;
- correlate durable browser/download/effect evidence;
- request human reconciliation when machine evidence cannot settle the effect.

It may not:

- dispatch the mutation again;
- reuse the consequence key through another transport;
- change authorization/material;
- interpret unrelated or pre-existing state as causal proof.

Where semantic transactions already support later destination verification, reuse or converge that machinery rather than creating competing semantics.

**Stop condition:** the motivating create-folder scenario can preserve one-dispatch safety while still reaching confirmed/not-applied when later authoritative evidence exists.

### 6. Align specialized and ordinary browser work

Review semantic transactions, upload/download evidence, navigation/history, task-result action plans, and ordinary interactions against the common model.

Keep specialized APIs only where their domain genuinely needs additional identity or multi-resource coordination. Common perception, settlement, evidence, and uncertainty semantics should not diverge accidentally.

**Stop condition:** the browser has one coherent meaning for dispatch, evidence, reconciliation, and unresolved outcome across ordinary and specialized operations.

### 7. Qualify generalization

Extend qualification around capability families rather than named websites.

Required evidence includes:

- structured-only success where structure is complete;
- automatic escalation when text/target coverage is truncated;
- visual escalation where accessible structure is insufficient;
- asynchronous state convergence;
- virtualized-list create/rename/move/remove outcomes;
- effect proof available in a different read surface from the commit surface;
- unknown immediate receipt later reconciled without mutation replay;
- genuine unresolved outcome where no authoritative evidence exists;
- human takeover/return during or after reconciliation;
- cross-task ownership and shared-host coordination unchanged.

Retain a sanitized regression reproducing the Drive failure shape without making live Google Drive a required deterministic test dependency. Use separately authorized live journeys only as additional acceptance evidence.

Measure unnecessary actions, observation/model volume, latency, and reconciliation depth so adaptability does not become uncontrolled wandering.

**Stop condition:** several unrelated application patterns pass through the same browser capability without site-specific execution rules.

### 8. Remove obsolete contract leakage

After the new path is qualified:

- remove or demote obsolete Codex-facing instructions that require low-level verification programming;
- keep compatibility identifiers only where installed data/protocol readers require them;
- update Implementation Status from actual evidence;
- update the capability atlas and regression fixtures;
- run the full repository and packaged-app qualification appropriate to the changed compatibility set.

Do not remove safety checks merely because higher-level orchestration becomes more capable.

## Verification requirements for every implementation slice

Every slice must preserve:

- exact task/page ownership;
- human takeover and return semantics;
- stale-grounding refusal;
- authorization/grant boundaries;
- one-dispatch consequence fencing;
- no alternate-route replay;
- truthful `confirmed` / `failed` / `unresolved` distinctions;
- local persistence/restart safety for any newly durable reconciliation truth;
- unrelated-task usability;
- bounded resource use.

A change that improves one website while weakening these invariants is not accepted.

## Explicit non-goals

This work does not authorize:

- a Google Drive-specific adapter;
- website-specific selectors or rule packs as the primary strategy;
- a second autonomous planning/model framework;
- mandatory hosted browsers;
- mandatory paid vision/perception APIs;
- disabling consequence fencing to make tasks appear successful;
- treating screenshots as proof without task/page/time grounding;
- broad network interception or unbounded payload retention;
- workflow-sync, identity, or recording redesign unrelated to browser execution.

## Completion condition

This plan is complete when the canonical contracts are implemented and qualified such that an unfamiliar browser task can normally be handled through adaptive structured/visual perception, grounded action, safe one-dispatch semantics, and read-only outcome reconciliation without requiring new website-specific engineering.

At that point, remaining failures should be classifiable as a concrete unsupported browser capability, a hard human/security/service boundary, or a bounded defect—not merely another consequence of the browser agent being forced to guess Rove's verifier internals.
