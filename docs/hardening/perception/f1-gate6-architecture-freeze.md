# F1 Gate 6 — Browser Perception Architecture Freeze

## Status

Accepted production architecture for F1 Browser Perception / Page-State
Classification hardening.

This document freezes the production architecture after:

- deterministic Tier-A corpus and benchmark work;
- frozen pre-fix baseline;
- evidence-channel research;
- strategy comparison;
- independent semantic challenges through Challenge H;
- production integration;
- runtime freshness enforcement;
- production latency/payload measurement;
- controlled Tier-D live validation;
- sanitized Tier-C replay recording.

Challenge H is the final independent synthetic semantic challenge for F1.
There is no Challenge I.

## Scope

F1 answers:

> What is the browser page state at the current observation point, and is the
> evidence strong and fresh enough to authorize autonomous mutation?

It does not attempt to infer an eternal property of a URL.

It does not solve CAPTCHAs, bypass restrictions, add stealth, defeat site
controls, or deliberately provoke human-verification challenges.

---

## 1. Frozen propositions

Each proposition is independently represented as:

```text
true | false | "indeterminate"
```

The production proposition set is:

```text
primaryContentAvailable
documentUnstable
authenticationRequired
humanVerificationPresented
accessRestricted
errorPresented
interstitialPresented
```

`indeterminate` is a first-class result. Missing or unavailable evidence is
never silently converted into a reassuring `false`.

---

## 2. Primary compatibility state

The compatibility state is derived from propositions using this precedence:

```text
human_verification
> authentication_required
> access_restricted
> error
> unknown_interstitial
> ready
```

When decision-relevant evidence is unstable or unavailable, the observation is
`loading` rather than forcing a stable semantic label.

`primaryContentAvailable` is independent from blocker state. A page may expose
content while also presenting an independent blocker.

---

## 3. Compatibility is not mutation authorization

The page-state assessment describes the current observation.

Autonomous mutation authorization is stricter.

A mutation is rejected unless the recorded inspection is:

- present;
- for the current page;
- fresh at the immediate pre-operation boundary;
- `ready`;
- `high` confidence;
- `documentUnstable === false`;
- every blocker proposition is exactly `false`.

The blocker propositions are:

```text
authenticationRequired
humanVerificationPresented
accessRestricted
errorPresented
interstitialPresented
```

A blocker proposition that is `true`, `indeterminate`, or missing is unsafe for
autonomous mutation.

`primaryContentAvailable` is not globally required for mutation authorization.

---

## 4. Production evidence architecture

```text
DOM / browser / HTTP evidence
          |
          v
bounded semantic fact collector
          |
          +--------------------+
          |                    |
          v                    v
   page-state inference   decision fingerprint
          |                    |
          v                    v
    propositions       freshness / stability
          |                    |
          +---------+----------+
                    |
                    v
              PageInspection
                    |
                    v
             InteractionPolicy
```

Research-only collectors and candidate implementations are not imported by the
production classifier.

---

## 5. Surface ownership

Semantic inference operates on explicit surfaces rather than page-global word
matching.

The production surface model is:

```text
primary workflow
blocking dialog
alert
supplementary surface
document-level verification frame
```

Supplementary surfaces include non-blocking sidebars, cards, footers, and
similar content.

Lexical blocker vocabulary on a supplementary surface does not establish a
workflow blocker.

---

## 6. Primary surface

The first visible `<main>` is the primary workflow surface.

If no visible `<main>` exists, the body/document root becomes the primary
surface.

This preserves root-only applications and simple pages without requiring
framework-specific markup.

---

## 7. Blocking dialogs

A visible dialog is blocker-eligible when it is independently blocking, such as
through:

- `aria-modal="true"`;
- an open native dialog;
- sufficient viewport coverage.

Blocking dialogs are evaluated independently from documentation/settings context
on the underlying primary page.

A documentation page may therefore still be blocked by a real modal
authentication, restriction, error, verification, or unknown interstitial
surface.

---

## 8. Alerts

An alert is not promoted to a workflow blocker merely because the primary
surface contains few or zero controls.

Alert restriction/error semantics require independent primary-workflow
corroboration that the workflow itself is unavailable.

This avoids classifying local informational warnings as global blockers.

---

## 9. Authentication

Strong structural authentication evidence includes:

```text
credential gate
identity chooser
passkey gate
```

Documentation context may suppress lexical authentication language, but it does
not suppress strong structural authentication.

A genuine settings context may suppress structural authentication when the
credential controls are account/security settings rather than a workflow gate.

---

## 10. Human verification

Passive provider presence never establishes human verification.

Human verification requires evidence that a verification workflow is actually
presented.

The production channels include:

- explicit verification directives/controls on an eligible owned surface;
- semantically labelled verification frames whose presentation geometry is
  established;
- document-level verification frames that are not owned by another semantic
  surface.

Frame presentation considers bounded geometry and visibility, including cases
such as hidden, opacity-zero, offscreen, tiny, clipped, and otherwise
non-presented frames.

If required presentation evidence cannot be established, the proposition may be
`indeterminate`; high-confidence autonomous continuation is not allowed.

---

## 11. Document-level verification frame channel

Semantic surface ownership does not own every meaningful iframe.

A verification-labelled iframe that:

- is not already owned by a semantic surface;
- is not inside a supplementary/dialog/alert boundary;
- has verification semantics;

is evaluated through the document-level verification-frame channel.

This prevents a body-level verification frame beside `<main>` from being
discarded solely because it is outside the primary surface.

---

## 12. Documentation/meta context

Documentation context suppresses lexical blocker interpretation; it does not
erase stronger independent evidence.

Existing title/heading role evidence remains supported.

Production additionally has a bounded document-role context for real
documentation pages whose title/heading alone does not identify their role.

The document-role rule is:

```text
docs-like pathname
AND
(>= 3 visible h1/h2/h3 nodes OR >= 3 visible pre/code nodes)
```

The accepted pathname classes are bounded documentation-oriented path
components such as:

```text
/docs/
/documentation/
/reference/
/manual/
/guide/
/guides/
```

Document-role structure is document-context evidence and therefore spans nested
sections.

This is deliberately different from blocker surface ownership.

A documentation-looking path alone is insufficient to suppress blockers.

This context suppresses lexical primary blocker signals only. It does not
suppress:

- HTTP blocker status;
- blocking dialogs;
- strong structural authentication;
- document-level verification frames.

---

## 13. HTTP evidence

HTTP evidence remains independent of lexical surface context.

Relevant HTTP status evidence can establish authentication, restriction, or
terminal error even on a documentation-shaped page.

Documentation suppression cannot turn an actual HTTP restriction response into
`ready`.

---

## 14. Observation-point semantics

A page that is valid and stable now may correctly be reported `ready` even when
a blocker appears later.

F1 does not wait indefinitely for hypothetical future semantic transitions.

Once a blocker appears, a later observation produces a different decision
fingerprint and the previous inspection becomes stale.

---

## 15. Decision-relevant stabilization

Whole-document quiet is not the stability definition.

Irrelevant page churn must not prevent a usable observation.

The production observer repeatedly collects bounded semantic facts and compares
the resulting decision fingerprint.

The stable observation path uses:

```text
quiet window: 75 ms
bounded observation ceiling: 1000 ms
poll interval: 10 ms
```

The 1000 ms ceiling is a safety bound, not a performance SLA.

If decision-relevant stability cannot be established within the bound, the
result is bounded `loading` / `wait_and_inspect`.

---

## 16. Freshness

Target/ref revision tracking and page-state freshness are separate concerns.

Target mutation tracking is optimized for target/reference staleness and is not
authoritative for page-state safety.

Page-state freshness uses:

```text
PageStateIdentity {
  pageId
  fingerprint
}
```

The fingerprint is derived from the bounded semantic decision:

```text
kind
confidence
signals
propositions
```

Immediately before autonomous mutation, runtime recomputes the current identity
and compares:

```text
recorded pageId == current pageId
recorded fingerprint == current fingerprint
```

Mismatch invalidates the inspection and requires reinspection.

No wall-clock TTL is used as the authoritative freshness rule.

---

## 17. Runtime ordering

For mutation, the frozen runtime ordering is:

```text
pace
-> immediate freshness authorization
-> operation
```

Freshness must occur after visible-mode pacing.

This prevents:

```text
fresh inspection
-> pacing delay
-> blocker appears
-> stale operation executes
```

Successful actions are followed by normal post-action synchronization and
reinspection.

Human-control return invalidates autonomous inspection state.

---

## 18. Confidence

High confidence is reserved for observations where:

- required bounded evidence is available;
- the decision-relevant state is stable;
- the winning semantic proposition has strong/direct support where required;
- meaningful competing blocker interpretations are excluded.

Evidence unavailability or unresolved presentation semantics must lower
confidence and/or emit `indeterminate`.

A low/medium-confidence `ready` result is compatibility information only and is
not sufficient for autonomous mutation.

---

## 19. Visual / OCR policy

Visual/OCR evidence is not on the F1 production default path.

The structural DOM, accessibility-adjacent semantics, geometry, HTTP, and
surface-ownership architecture is sufficient for the accepted F1 production
candidate.

Visual/OCR may only be considered as an explicit bounded escalation when:

1. required semantic evidence is otherwise genuinely ambiguous or unavailable;
2. structural channels cannot safely establish the proposition;
3. the caller explicitly enables the visual path;
4. privacy constraints allow the capture;
5. failure/unavailability remains safe and produces indeterminate or human
   escalation rather than guessed continuation.

Visual/OCR must never be used to:

- solve CAPTCHA/human-verification challenges;
- defeat site restrictions;
- add stealth;
- infer or persist secrets/private values;
- turn ambiguous blocker evidence into high-confidence continuation.

Unsanitized external screenshots are not committed.

---

## 20. Privacy and persistence

Default production page-state evidence is bounded and derived.

Do not persist external:

- raw HTML;
- full body/page text;
- raw accessibility snapshots;
- request/response bodies;
- request/response headers;
- cookies;
- authorization;
- bearer tokens;
- passwords;
- OTP/one-time codes;
- localStorage;
- sessionStorage;
- IndexedDB content;
- private form/input values;
- unsanitized screenshots.

External recorded URLs must be sanitized.

Tier-C recorded evidence uses `f1-perception-replay/v1` and the existing replay
persistence validator.

Tier C maps to source kind:

```text
recorded
```

The five accepted F1 Tier-C records are bounded, sanitized replay artifacts.

---

## 21. Tier-D live validation policy

Tier D is controlled, small, read-only external validation.

Live validation stops when the observed site presents:

```text
human_verification
access_restricted
```

F1 does not continue through those states.

Live external evidence is not deterministic CI ground truth.

The accepted Tier-D evidence covered:

- normal ready page;
- documentation lexical adversary;
- public authentication page;
- HTTP terminal error;
- HTTP restriction.

The documentation lexical adversary exposed one production generalization defect
during Gate 6. That defect was remediated through bounded document-role context
and revalidated before Tier C recording.

---

## 22. Performance measurements

Production latency/payload was measured on 21 deterministic/local cases.

Samples:

```text
inspect samples:   84
identity samples: 168
```

Observed:

```text
inspect()
  mean  91.47 ms
  p95   96.77 ms
  max   97.16 ms

pageStateIdentity()
  mean   2.72 ms
  p95    3.57 ms
  max    4.06 ms

page-state metadata payload
  mean 517.05 B
  p95  701 B
  max  738 B

minimal no-text/no-target inspection
  mean 692.62 B
  p95  887 B
  max  915 B
```

The full `inspect()` cost includes the decision-relevant quiet window.

The immediate pre-mutation freshness identity is intentionally a one-shot
bounded observation and is substantially cheaper.

---

## 23. Frozen production performance budgets

For deterministic/local release measurement:

```text
inspect() p95                         <= 125 ms
inspect() max                         <= 150 ms

pageStateIdentity() p95               <= 10 ms
pageStateIdentity() max               <= 15 ms

page-state metadata payload           <= 1 KiB
minimal no-text/no-target inspection  <= 1.5 KiB
```

These budgets intentionally leave margin above the measured deterministic
results.

They are release/performance budgets, not flaky per-test wall-clock assertions.

External live network/navigation timing is not governed by these local
acquisition budgets.

The 1000 ms stabilization ceiling is a safety bound and must not be interpreted
as the normal `inspect()` latency SLA.

---

## 24. Failure behavior

When required evidence cannot be acquired or freshness cannot be established:

```text
fail closed for autonomous mutation
```

Typical behavior is:

```text
loading / wait_and_inspect
indeterminate blocker proposition
inspection required
request human
```

depending on which evidence is unavailable and which proposition is implicated.

Acquisition failure must never be converted into a high-confidence `ready`
authorization.

---

## 25. Diagnostics

Useful bounded diagnostic outputs include:

- primary compatibility state;
- confidence;
- semantic signals;
- proposition set;
- decision fingerprint equality;
- stabilization result;
- bounded latency;
- bounded payload size;
- sanitized replay validation results.

Diagnostics must not require persisting raw external content.

---

## 26. Rollout and revert

F1 production integration is contained behind the browser page-state collector,
decision layer, inspection metadata, and runtime interaction policy.

If a regression requires rollback:

1. stop autonomous mutation where fresh high-confidence readiness cannot be
   established;
2. retain human-control/handoff behavior;
3. revert the Gate-6 production integration commit as one unit;
4. preserve the Gate 1-5 research history and frozen evidence;
5. reproduce the regression in deterministic/sanitized evidence before a new
   production architecture is accepted.

A rollback must not restore permissive mutation behavior that treats missing or
low-confidence inspection as safe.

---

## 27. Acceptance evidence

At architecture freeze:

- frozen S4R7 candidate remains unchanged;
- Challenge H is the final independent semantic challenge;
- deterministic frozen/remedial/independent production corpus is green;
- production-only document-role regressions are green;
- temporal decision-relevant stabilization is green;
- runtime freshness and pace-before-freshness regression is green;
- typecheck, lint, and build are green;
- controlled Tier-D validation is green after remediation;
- five sanitized Tier-C recorded replays pass the persistence validator;
- recorded Tier-C evidence contains no forbidden fields;
- production latency/payload remains comfortably inside the frozen local budgets.

Gate 6 is not complete until the final repository-wide validation, including the
whole-repository test command, is green.
