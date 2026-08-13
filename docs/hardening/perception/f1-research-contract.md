# F1 Browser Perception Research Contract

## Status

Gate 1 research contract for F1 browser perception.

This document freezes the semantics, overlap rules, risk model, privacy
constraints, benchmark metrics, and candidate acceptance criteria that must be
defined before F1 changes browser perception or page-state classification.

It is a research contract, not a production architecture decision.

Gate 1 must not change:

- `PageStateKind`
- `PageStateAssessment`
- `classifyPageState()`
- runtime mutation policy
- browser evidence acquisition
- human-handoff behavior

The production architecture is intentionally deferred until the evidence,
stabilization, ablation, visual, inference, and validation experiments are
complete.

## Research objective

F1 must answer:

> What can the browser actually establish about the current page from bounded,
> explainable evidence, and how should that evidence determine a safe runtime
> disposition?

F1 must not begin from the assumption that the current classifier merely needs
a larger ruleset.

The research sequence is:

```text
define semantics
    ↓
build deterministic corpus
    ↓
freeze acquisition + classification baseline
    ↓
measure candidate evidence
    ↓
stabilize acquisition
    ↓
run ablations
    ↓
test visual escalation where justified
    ↓
compare inference strategies
    ↓
validate recorded and controlled-live cases
    ↓
freeze production architecture in an ADR
```

## Current compatibility surface

The current production page-state contract remains:

```text
ready
loading
authentication_required
human_verification
access_restricted
unknown_interstitial
error
```

with current dispositions:

```text
ready                   -> continue
loading                 -> wait_and_inspect
authentication_required -> request_human
human_verification      -> request_human
access_restricted       -> request_human
unknown_interstitial    -> request_human
error                   -> stop
```

F1 research must remain able to produce a compatible primary state for
benchmarking, but the research model must not assume these labels are mutually
exclusive facts about a page.

## Ground-truth propositions

Corpus cases are labeled first using independent propositions.

Each proposition has one of three annotation values:

```text
true
false
indeterminate
```

`indeterminate` is permitted when evidence cannot support a defensible
ground-truth judgment. Deterministic fixtures should avoid `indeterminate` for
the proposition they are specifically designed to exercise.

### `primaryContentAvailable`

The intended page content or workflow is perceptibly present and usable.

This proposition does not itself authorize mutation. Useful content may be
visible while another blocking proposition is also true.

### `documentUnstable`

The current observation is transient enough that stronger semantic
classification is not yet trustworthy.

Examples include hydration, delayed overlays, delayed authentication UI, or a
meaningful transition already known to be in progress.

`document.readyState` is evidence for this proposition, not its definition.

`readyState === "interactive"` therefore does not automatically mean the page
is semantically still loading.

### `authenticationRequired`

The intended workflow cannot continue until the user authenticates or selects
an authenticated account.

Authentication terminology in unrelated content does not establish this
proposition.

### `humanVerificationPresented`

A human-verification interaction is currently presented to the user and
requires human participation before the intended workflow can continue.

This means presented and relevant now, not merely that CAPTCHA infrastructure,
provider terminology, or a provider frame exists somewhere.

### `accessRestricted`

The site is presently denying, throttling, or otherwise restricting access to
the intended workflow.

Restriction terminology in unrelated content does not establish this
proposition.

### `errorPresented`

A meaningful document, page, or service failure is presently preventing the
normal workflow.

An HTTP error status can be evidence. The proposition describes the actual
failure semantics rather than a status code in isolation.

### `interstitialPresented`

The current user-facing experience is an intervening page or overlay rather
than the intended destination or workflow.

Known authentication, verification, and restriction experiences may also be
interstitials.

`interstitialPresented` therefore does not imply `unknown_interstitial`.

## Overlap semantics

The propositions are intentionally non-exclusive.

Examples:

| Situation                                               | Expected propositions                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Login page with visible verification challenge          | `authenticationRequired=true`, `humanVerificationPresented=true`, usually `interstitialPresented=true` |
| Access restriction with visible verification challenge  | `accessRestricted=true`, `humanVerificationPresented=true`, usually `interstitialPresented=true`       |
| Hydrating page before authentication UI stabilizes      | `documentUnstable=true`; authentication may remain `indeterminate` until stabilization                 |
| Access-denied page returned with a 5xx response         | `accessRestricted=true` and `errorPresented=true` when both semantics are established                  |
| Intended content behind a blocking verification overlay | `primaryContentAvailable=true`, `humanVerificationPresented=true`, `interstitialPresented=true`        |

The benchmark must preserve overlaps instead of erasing them during annotation.

## Derived primary state

The existing protocol requires one primary `PageStateKind`, so benchmark cases
also carry `expectedPrimaryState`.

This field is a compatibility disposition, not the complete semantic truth.

`ready` means the observation is sufficiently stable for the current runtime
contract and no blocking proposition has been established. It does not require
`primaryContentAvailable=true`.

For example, an intentionally blank or new-tab-like stable document may be
`ready` even though no intended application content is present. Content
availability and safety readiness remain separate research dimensions.

### Stabilization rule

If `documentUnstable=true` and stronger semantic propositions cannot yet be
trusted, the primary state is:

```text
loading
```

The benchmark should stabilize and reassess rather than force a semantic label
from a transient snapshot.

A stable, directly established blocker must not be hidden merely because
background loading continues.

### Stable-state compatibility precedence

Once the observation is sufficiently stable, derive the compatibility primary
state using the immediate blocker:

```text
humanVerificationPresented
    -> human_verification

authenticationRequired
    -> authentication_required

accessRestricted
    -> access_restricted

errorPresented
    -> error

stable unknown interstitial
    -> unknown_interstitial

otherwise, stable with no established blocker
    -> ready
```

This precedence exists only so the current single-label protocol can be
benchmarked consistently.

It does not assert that lower propositions are false.

### Immediate-blocker principle

When multiple request-human propositions are true, the primary state should
describe the immediate user-resolvable blocker currently presented.

For example:

```text
login form
+
visible verification challenge
```

is propositionally both authentication and verification while the immediate
blocking interaction is verification.

Likewise:

```text
access restriction
+
visible verification challenge required to proceed
```

may establish both restriction and verification while the immediate presented
human task is verification.

## `unknown_interstitial` semantics

`unknown_interstitial` is an epistemic fallback, not a peer visual pattern and
not a synonym for "the classifier does not know."

It may be used only when all of the following are true:

1. the page is sufficiently stable to assess;
2. an interstitial or blocking intervening experience is actually presented;
3. the normal workflow cannot safely be treated as ready;
4. authentication, human verification, access restriction, and error cannot be
   established with sufficient evidence;
5. ordinary stabilization is not the more appropriate action.

The following do not independently establish `unknown_interstitial`:

- an empty body during navigation;
- zero discovered targets;
- a large but non-semantic DOM;
- canvas-rendered content by itself;
- an unfamiliar framework;
- a cross-origin iframe by itself;
- failure of one evidence collector;
- insufficient classifier implementation.

Unknown is an intentional representation of bounded uncertainty, not a bucket
for implementation shortcomings.

## Evidence and inference separation

F1 collectors collect bounded facts.

Collectors must not silently encode final semantic decisions.

Prefer evidence such as:

```text
frame origin
frame parent
frame visibility
frame geometry
viewport overlap
accessible role
accessible name
document status
navigation event
element visibility
```

over:

```text
hasCaptcha=true
isLogin=true
isRestricted=true
```

Semantic propositions belong to inference.

## Human-verification invariant

No non-interactive provider presence alone may establish
`humanVerificationPresented`.

None of the following by itself is sufficient:

- provider script loaded;
- provider domain requested;
- provider iframe exists;
- provider URL appears in frame metadata;
- raw HTML contains `captcha`, `recaptcha`, `hcaptcha`, `turnstile`, or similar
  terminology;
- visible prose discusses CAPTCHA technology;
- hidden verification markup exists;
- offscreen verification markup exists;
- a 1x1 provider frame exists.

A challenge must be supported by evidence that a verification interaction is
actually presented and currently relevant to user progress.

This is a hard F1 invariant.

## Visibility semantics

"Presented" means relevant to the current user-visible experience.

The corpus must distinguish at minimum:

- visible;
- `display:none`;
- `visibility:hidden`;
- `opacity:0`;
- offscreen;
- clipped;
- zero-area or effectively 1x1;
- behind another blocking surface;
- visible but outside the viewport;
- visible and materially overlapping the viewport.

The experiments determine which measurements are required to make those
distinctions reliably.

This contract does not preselect the winning evidence channel.

## Temporal semantics

A page-state assessment is a statement about an observation point, not an
eternal property of a URL.

The corpus must be able to represent transitions such as:

```text
loading -> ready
loading -> authentication_required
ready -> human_verification
authentication_required -> ready
human_verification -> ready
ready -> access_restricted
```

Evidence channels must not be compared until stabilization research has
established when a snapshot is valid enough to compare.

## Confidence semantics

Confidence describes strength of support for the emitted assessment.

It must not describe how deterministic the implementation code happens to be.

### High confidence

Use only when direct or strongly corroborated evidence supports the result and
the competing high-cost alternatives have been sufficiently excluded.

### Medium confidence

Use when evidence supports the result but meaningful ambiguity remains.

### Low confidence

Use when the result is the safest bounded inference but evidence remains weak.

A wrong high-confidence result is more costly than the same wrong result
emitted with lower confidence.

The benchmark therefore measures:

```text
high-confidence error rate
```

in addition to ordinary classification metrics.

## Asymmetric risk model

Classification errors do not have equal cost.

The canonical machine-readable matrix is:

```text
docs/hardening/perception/f1-risk-model.json
```

Rows represent actual ground truth.

Columns represent predicted primary state.

Base costs range from `0` through `100`.

Incorrect predictions are multiplied by the emitted-confidence multiplier in
the same file.

The matrix is versioned.

Once Gate 1 is committed, changing the matrix requires:

1. an explicit version increment;
2. a documented rationale;
3. rerunning every existing benchmark or baseline result affected by the
   change;
4. once the Gate 3 frozen baseline exists, rerunning that baseline and every
   strategy being compared.

The risk model must never be changed merely to make a candidate strategy look
better.

## Safety asymmetry

High-cost failure families include:

### False continuation

A blocker is actually present but the system predicts `ready`.

Especially:

```text
human_verification      -> ready
access_restricted       -> ready
authentication_required -> ready
error                   -> ready
```

These can allow unsafe or nonsensical mutations.

### False human-verification handoff

A normal ready page is classified as `human_verification`.

This is especially costly because incidental CAPTCHA terminology or passive
provider infrastructure must not take control away from the autonomous
workflow.

### False restriction handoff

A normal ready page is classified as `access_restricted`.

This unnecessarily halts useful work and misrepresents the site's state.

### Wrong high confidence

Any incorrect label emitted with high confidence is additionally penalized.

## Benchmark case contract

Every deterministic benchmark case must eventually include:

```text
id
tier
description
expectedPropositions
expectedPrimaryState
expectedDisposition
criticality
tags
notes
```

Recommended proposition shape:

```ts
expectedPropositions: {
  primaryContentAvailable: true | false | "indeterminate";
  documentUnstable: true | false | "indeterminate";
  authenticationRequired: true | false | "indeterminate";
  humanVerificationPresented: true | false | "indeterminate";
  accessRestricted: true | false | "indeterminate";
  errorPresented: true | false | "indeterminate";
  interstitialPresented: true | false | "indeterminate";
}
```

`expectedPrimaryState` exists for current-protocol compatibility.

`expectedPropositions` remains the richer ground truth.

## Corpus tiers

### Tier A — deterministic local corpus

Locally controlled fixtures.

This is the release-quality deterministic benchmark.

Third-party network dependencies are not permitted.

### Tier B — controlled provider integrations

Official provider test integrations such as CAPTCHA/verification test
environments.

These validate compatibility but are not deterministic CI ground truth.

### Tier C — recorded real evidence

Sanitized evidence captured from representative real pages.

Recorded cases must not contain credentials, secrets, cookies, authentication
tokens, private form values, or unsanitized personal data.

### Tier D — controlled live validation

Small read-only external validation.

Live validation must stop when a site requests human verification or restricts
access.

F1 does not solve CAPTCHAs, bypass restrictions, add stealth behavior, or
attempt to defeat site controls.

## Privacy and persistence contract

Research evidence may be richer in memory than what is persisted.

### Synthetic evidence

Raw fixture HTML, fixture text, screenshots, and synthetic network metadata may
be committed when entirely generated and controlled by Rove.

### External or user-derived evidence

By default, do not commit:

- raw page HTML;
- full page body text;
- unsanitized screenshots;
- request or response bodies;
- cookies;
- localStorage;
- sessionStorage;
- IndexedDB contents;
- authentication headers;
- bearer tokens;
- passwords;
- OTP values;
- private form values.

Persisted external URLs must remove credentials, query strings, and fragments,
and sensitive path components must be sanitized when necessary.

Accessibility evidence must not persist sensitive input values.

Network experiments should prefer bounded structural metadata such as:

```text
resource type
method
status
origin
sanitized path class
timing
frame relationship
```

rather than payload bodies or authentication material.

### Screenshots

Screenshots are permitted in the experimental harness when explicitly enabled.

They are not default production evidence during F1 research.

Unsanitized live screenshots must not be committed.

A screenshot becomes part of a recorded regression only after explicit
sanitization or when it comes from a fully synthetic fixture.

## Benchmark metrics

Gate 2 must support at least:

- exact primary-state accuracy;
- per-state precision;
- per-state recall;
- per-state F1;
- macro F1;
- confusion matrix;
- proposition-level accuracy where ground truth is determinate;
- risk-weighted loss;
- high-confidence error count and rate;
- critical-invariant violation count;
- unknown rate;
- acquisition latency;
- inference latency;
- total assessment latency;
- evidence payload size;
- persisted artifact size.

Accuracy alone is never sufficient to choose the production architecture.

## Hard invariants

A production candidate is ineligible if the deterministic corpus contains any
of the following:

1. passive/non-interactive provider presence alone establishes
   `human_verification`;
2. a stable known-ready case is classified as `authentication_required`,
   `human_verification`, `access_restricted`, `unknown_interstitial`, or
   `error`;
3. a known human-verification case is classified as `ready`;
4. a known access-restriction case is classified as `ready`;
5. a known authentication-required case is classified as `ready`;
6. a known terminal-error case is classified as `ready`;
7. a stable known semantic blocker is replaced by `unknown_interstitial`
   merely because the classifier lacks an implementation rule;
8. an unstable transitional case is forced into a stable semantic label when
   the evidence is not yet trustworthy;
9. sensitive external evidence is persisted in violation of this contract.

Hard-invariant violations are counted, not averaged away.

## Candidate quality threshold

To be eligible for the final architecture decision, a candidate should satisfy
all of the following on eligible deterministic cases:

```text
critical invariant violations = 0
high-confidence error rate    = 0
primary-state accuracy        >= 0.98
macro F1                      >= 0.98
risk-weighted loss            < frozen baseline risk-weighted loss
```

A reduction of at least 50% in risk-weighted loss versus the frozen baseline is
the target, not a license to violate hard invariants.

Small recorded/live validation sets should report raw error counts as well as
percentages so tiny sample sizes do not create misleading metrics.

## Performance interpretation

Gate 1 intentionally does not freeze an arbitrary absolute latency budget
before the baseline exists.

Gate 2 must measure latency and payload.

Gate 3 freezes the current baseline.

Gate 4 and Gate 5 compare candidate evidence and inference costs against that
baseline.

A candidate that improves classification but imposes excessive default-path
latency, payload, or privacy cost may still be rejected.

Visual evidence must not become default acquisition merely because the
benchmark harness can capture it.

## Gate 1 completion criteria

Gate 1 is complete when:

- this research contract is committed;
- the machine-readable risk model is committed;
- proposition semantics are explicit;
- overlap semantics are explicit;
- primary-state compatibility rules are explicit;
- `unknown_interstitial` semantics are explicit;
- human-verification presence semantics are explicit;
- asymmetric error costs are frozen;
- confidence error multipliers are frozen;
- privacy/persistence constraints are frozen;
- benchmark metrics are specified;
- candidate acceptance criteria are specified;
- production classifier behavior remains unchanged.

Gate 2 may then build the deterministic corpus and benchmark foundation against
this contract.
