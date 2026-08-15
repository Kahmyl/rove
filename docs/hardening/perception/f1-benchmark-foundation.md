# F1 Perception Benchmark Foundation

## Status

Gate 2 implementation for the F1 browser-perception research program.

This gate builds the corpus, scoring, replay, and execution foundation needed
to freeze the current baseline in Gate 3.

Gate 2 does not change production classification behavior.

## Layout

```text
packages/browser/src/perception/
  benchmark/
    types.ts
    risk-model.ts
    metrics.ts
    runner.ts
    replay.ts
    current-classifier-cli.ts
  corpus/
    local-corpus.ts
    provider-cases.ts
```

The research harness is intentionally not exported from the public
`@rove/browser` package surface.

## Tier A deterministic corpus

`local-corpus.ts` contains deterministic classifier inputs and locally served
browser fixtures.

The initial corpus covers:

- all seven current primary states;
- ordinary ready pages;
- intentionally blank ready pages;
- misleading security terminology;
- CAPTCHA terminology in ordinary content;
- rich pages with passive provider frames;
- hidden provider frames;
- fully transparent provider frames;
- offscreen provider frames;
- 1x1 provider frames;
- clipped provider frames;
- provider frames behind the current visible surface;
- explicit visible human verification;
- content-rich explicit verification;
- authentication;
- explicit access restriction;
- HTTP 429 restriction;
- HTTP 503 error;
- stable unknown visual interstitial whose canvas is actually painted while
  main-frame body text remains empty;
- authentication + verification overlap;
- restriction + verification overlap;
- restriction + error overlap;
- a signal-only unstable/loading snapshot.

The browser fixture routes never require third-party network access.

The signal-only loading case is not marked pipeline-eligible because Gate 2
does not pretend a post-navigation browser snapshot is equivalent to an
unstable acquisition point.

## Temporal corpus

Temporal fixtures are separate from stable benchmark cases.

Initial scenarios include:

```text
ready -> human_verification
loading -> ready
loading -> authentication_required
```

They have declared checkpoints for research, but Gate 2 does not score them as
ordinary stable snapshots.

Gate 4 stabilization research must determine the observation policy before
temporal scenarios participate in architecture comparisons.

## Tier B provider integrations

Provider integrations are described separately in `provider-cases.ts`.

They are:

- network-dependent;
- opt-in;
- disabled by default;
- configured only through explicit F1 test URL environment variables;
- excluded from deterministic CI ground truth.

Gate 2 does not contact provider services.

## Benchmark model

A benchmark strategy receives:

- the case input;
- case ID;
- tier;
- description;
- criticality;
- tags.

It does not receive expected labels through the strategy interface.

A prediction may provide:

- `PageStateAssessment`;
- proposition inference;
- acquisition latency;
- inference latency;
- total latency;
- evidence bytes;
- persisted-artifact bytes.

Not every strategy can provide every research channel. Missing measurements are
reported with zero sample coverage rather than invented.

## Metrics

The benchmark reports:

- primary-state accuracy;
- disposition accuracy;
- per-state precision;
- per-state recall;
- per-state F1;
- macro F1 over states represented in ground truth;
- confusion matrix;
- per-proposition coverage and accuracy;
- aggregate proposition coverage and accuracy;
- total risk-weighted loss;
- mean risk-weighted loss per case;
- high-confidence prediction count;
- high-confidence error count and rate;
- critical-invariant violation count;
- unknown count and rate;
- acquisition latency distribution;
- inference latency distribution;
- total latency distribution;
- evidence-byte distribution;
- persisted-artifact-byte distribution.

### High-confidence error denominator

`highConfidenceErrorRate` is:

```text
wrong high-confidence primary-state predictions
------------------------------------------------
all high-confidence primary-state predictions
```

If there are no high-confidence predictions, the rate is `0`.

### Risk-weighted loss

For an incorrect primary-state prediction:

```text
risk cost
  = Gate 1 base cost[expected][predicted]
  × emitted confidence error multiplier
```

Correct primary-state predictions have zero primary-state risk cost.

`riskWeightedLoss` is the mean risk cost per benchmark case.

`totalRiskWeightedLoss` is also retained for auditability.

Disposition mismatches are reported separately from primary-state risk.

## Case criticality

`criticality` is corpus metadata for prioritization and slicing.

It does **not** redefine the Gate 1 hard invariants and it does not mean that
every possible wrong label on a `critical` case is itself a hard-invariant
violation.

The initial corpus uses `critical` for direct high-risk boundaries and
`standard` for broader semantic/precedence coverage.

## Critical-invariant accounting

Classification hard-invariant violations follow the Gate 1 contract rather
than a blanket "critical case was wrong" rule.

A classification counts as a hard-invariant violation when:

1. its expected/predicted pair is one of the canonical Gate 1 critical pairs;
2. a known `authentication_required`, `human_verification`,
   `access_restricted`, or `error` blocker is replaced by
   `unknown_interstitial`; or
3. a ground-truth `loading`/unstable snapshot is forced into a stable semantic
   state.

Disposition mismatches remain visible through `dispositionErrorCount` and
`dispositionAccuracy`; they are not silently relabeled as classification hard
invariants.

Replay privacy violations are rejected at the persistence boundary rather than
represented as classifier confusion-matrix entries.

Violations are counted per case and are never averaged away.

## Proposition metrics

Ground-truth proposition values marked `indeterminate` are excluded from
proposition accuracy.

If a strategy does not emit a determinate proposition prediction, that item
reduces proposition coverage but is not fabricated as a correct or incorrect
inference.

This permits Gate 3 to measure the current single-label classifier honestly:
its proposition coverage can be zero while later proposition-aware strategies
can be compared explicitly.

## Replay format

`f1-perception-replay/v1` is the initial replay envelope.

The parser validates the complete v1 envelope, including tier/source-kind
coupling, proposition keys and truth values, expected state/disposition,
criticality, tags, optional assessment shape, timing, and payload
measurements.

Source pairing is fixed for v1:

```text
Tier A -> synthetic
Tier B -> provider
Tier C -> recorded
Tier D -> recorded
```

This prevents recorded evidence from bypassing persistence constraints by
claiming a synthetic source shape.

Tier A synthetic evidence may contain controlled raw HTML and text.

Tier B/C/D persisted replay evidence rejects sensitive or unbounded fields such
as:

- raw HTML;
- full generic text;
- request/response bodies;
- cookies;
- authorization;
- bearer tokens;
- passwords;
- OTP values;
- local/session storage;
- IndexedDB content.

External persisted URLs must not contain credentials, query strings, or
fragments. URL arrays are checked as well as scalar URL fields. Local `file:`
and `data:` URLs are rejected for external persisted evidence.

Callers should sanitize sensitive paths before persistence.

The helper defaults external URL paths to `/` unless a caller provides an
explicit sanitized path class.

The persistence validator walks the complete external replay envelope and
rejects known sensitive/raw field families. This is a structural privacy
boundary, not a substitute for deliberate sanitization of authored
descriptions, tags, safe excerpts, or other allowed metadata.

## Current-classifier measurement command

From the repository root:

```sh
pnpm browser:perception-benchmark
```

Optional JSON output:

```sh
pnpm browser:perception-benchmark -- --out /path/to/result.json
```

The command measures the current pure classifier against the Tier A direct
signal corpus.

It is a measurement command, not an acceptance gate.

Gate 2 must not tune the classifier in response to the output.

Gate 3 reruns the command and commits the frozen classifier baseline before
classifier changes are allowed.

## Gate 2 acceptance

Gate 2 is complete when:

- the deterministic Tier A corpus is versioned;
- all current primary states are represented;
- adversarial provider-presence and overlap cases exist;
- visibility adversaries exist;
- temporal scenarios exist separately from stable snapshots;
- Tier B provider integrations are isolated and default-disabled;
- the benchmark runner can score arbitrary strategies;
- the canonical Gate 1 risk model is loaded rather than duplicated;
- metric semantics are tested;
- replay privacy rules are tested;
- deterministic fixture routes use only local dependencies;
- the current-classifier benchmark command runs;
- production classifier, protocol, acquisition, and runtime policy behavior
  remain unchanged;
- relevant tests, typecheck, lint, and build pass.

Gate 3 then freezes the current classifier and real `browser.inspect()`
acquisition baselines.
