# F1 Gate 6 Held-Out Challenge

## Status

Pre-freeze validation challenge against the Gate-5 S4 candidate.

**Architecture is not frozen by this artifact.** Gate 6 first attempts to
falsify S4 on held-out semantics, browser accessibility, channel-unavailability,
temporal variation, irrelevant mutation, confidence, and legitimate visual
controls.

Frozen Gate 1-5 artifacts and production behavior are unchanged.

## Held-out S4 result

- cases: 12
- primary accuracy: 25.00%
- macro F1: 0.071429
- mean risk loss: 98.125
- high-confidence error rate: 80.00%
- wrong high-confidence predictions: 8
- critical invariant violations: 7
- proposition coverage: 100.00%
- proposition accuracy: 71.43%

| Case                                        | Expected                  | S4                   | Confidence |  Risk | Critical |
| ------------------------------------------- | ------------------------- | -------------------- | ---------- | ----: | -------- |
| `heldout-ready-quoted-verification-doc`     | `ready`                   | `human_verification` | high       | 150.0 | yes      |
| `heldout-ready-painted-canvas-app`          | `ready`                   | `ready`              | medium     |   0.0 | no       |
| `heldout-auth-form-title-variant`           | `authentication_required` | `ready`              | high       | 142.5 | yes      |
| `heldout-auth-account-chooser`              | `authentication_required` | `ready`              | high       | 142.5 | yes      |
| `heldout-restriction-paraphrase`            | `access_restricted`       | `ready`              | high       | 150.0 | yes      |
| `heldout-error-paraphrase-200`              | `error`                   | `ready`              | high       | 142.5 | yes      |
| `heldout-verification-frame-title-only`     | `human_verification`      | `ready`              | medium     | 120.0 | yes      |
| `heldout-verification-paraphrase-frame`     | `human_verification`      | `ready`              | high       | 150.0 | yes      |
| `heldout-overlap-restriction-verification`  | `human_verification`      | `access_restricted`  | high       |  60.0 | no       |
| `heldout-unknown-dialog-labelledby`         | `unknown_interstitial`    | `ready`              | high       | 120.0 | no       |
| `heldout-ready-visible-ordinary-iframe`     | `ready`                   | `ready`              | high       |   0.0 | no       |
| `heldout-ready-hidden-accessible-challenge` | `ready`                   | `ready`              | high       |   0.0 | no       |

Held-out failures: **9/12**.

The held-out set falsifies the Gate-5 S4 implementation as a production-ready classifier. Gate 6 must remediate the architecture candidate and rerun this challenge before an ADR can freeze it.

## Browser accessibility audit

Gate 5's winning score used an HTML `aria-label` regex as an
accessibility-shaped signal. Gate 6 separately executes Playwright
`ariaSnapshot()` against held-out variants and persists only bounded
hash/count/boolean facts.

The audit includes:

- `aria-labelledby` dialog semantics;
- iframe accessible naming;
- hidden challenge-labelled content;
- authentication/restriction/error semantic variants.

Raw accessibility snapshots are not persisted.

## Channel unavailability

- `verification-frame-without-all-research-evidence`: expected `human_verification`, got `ready` (medium); incorrect.
- `verification-frame-with-unavailable-geometry`: expected `human_verification`, got `ready` (medium); incorrect.
- `ordinary-iframe-with-unavailable-geometry`: expected `ready`, got `ready` (high); correct.
- `quoted-copy-without-research-evidence`: expected `ready`, got `human_verification` (high); incorrect.

Missing evidence is measured explicitly. Gate 1 forbids turning collector
failure into `unknown_interstitial` merely because implementation evidence is
missing.

For temporal validation, whole-document cross-channel acquisition may be
reported as `unstable_during_acquisition` with no fabricated semantic
assessment. The decision-relevant branch is a validation-only probe: after the
decision-relevant signature stabilizes, it evaluates these authored temporal
fixtures from bounded semantic signals instead of requiring unrelated DOM noise
to become globally quiet.

## Temporal challenge

The Gate-5 whole-document quiet policy is compared with a validation-only
decision-relevant stability probe. The latter is **not yet a frozen production
algorithm**; it tests whether irrelevant DOM churn and long-lived semantic
instability invalidate whole-document quiet as the architecture primitive.

| Scenario                           | Delay ms | Noise | Whole-doc ms | Whole-doc timeout | Expected @ observation    | S4 @ observation                          | Relevant ms | Relevant timeout | Expected @ observation    | Candidate-safe result     |
| ---------------------------------- | -------: | ----- | -----------: | ----------------- | ------------------------- | ----------------------------------------- | ----------: | ---------------- | ------------------------- | ------------------------- |
| `heldout-temporal-ready-50`        |       50 | no    |      310.000 | no                | `ready`                   | `ready`                                   |     135.024 | no               | `ready`                   | `ready`                   |
| `heldout-temporal-auth-250`        |      250 | no    |      341.300 | no                | `authentication_required` | `authentication_required`                 |     341.707 | no               | `authentication_required` | `authentication_required` |
| `heldout-temporal-auth-800`        |      800 | no    |      304.000 | no                | `loading`                 | `ready`                                   |     886.494 | no               | `authentication_required` | `authentication_required` |
| `heldout-temporal-ready-800`       |      800 | no    |      313.400 | no                | `loading`                 | `ready`                                   |     886.176 | no               | `ready`                   | `ready`                   |
| `heldout-temporal-ready-noisy-200` |      200 | yes   |     1005.600 | yes               | `ready`                   | unavailable (unstable_during_acquisition) |     293.968 | no               | `ready`                   | `ready`                   |
| `heldout-temporal-auth-noisy-200`  |      200 | yes   |     1007.900 | yes               | `authentication_required` | unavailable (unstable_during_acquisition) |     294.073 | no               | `authentication_required` | `authentication_required` |
| `heldout-temporal-long-1200`       |     1200 | no    |      306.000 | no                | `loading`                 | `ready`                                   |    1008.434 | yes              | `loading`                 | `loading`                 |

The 1200 ms case intentionally exceeds the bounded 1000 ms validation envelope.
A timeout while semantic instability remains is represented as `loading`,
not forced into a stable blocker or `ready`.

## Observation-point semantics

A stable public page that receives a verification overlay 450 ms later produced:

- initial observation: `ready`;
- later re-observation: `human_verification`.

Gate 1 defines state at an observation point, not as a prediction of all future
DOM changes. Production safety therefore depends on invalidating/requiring a
fresh inspection after relevant browser activity rather than universally
waiting long enough to predict future blockers.

## Painted-canvas control

Legitimate canvas:

- materially painted: true
- non-transparent ratio: 1
- expected: `ready`

Known unknown interstitial canvas:

- materially painted: true
- non-transparent ratio: 1
- expected: `unknown_interstitial`

Pixel occupancy semantically separates them: **false**.

This directly tests Gate 5's limitation. If both are materially painted, pixel
occupancy is not sufficient evidence for unknown-interstitial semantics.

## Acquisition cost on held-out browser cases

- mean acquisition: 15.970 ms
- p95 acquisition: 23.404 ms
- mean bounded evidence: 1427.0 bytes
- p95 bounded evidence: 1904.0 bytes

These are research-collector costs, not yet a production default-path budget.

## Freeze decision

This artifact intentionally does not create the ADR or production runbook.

Gate 6 may freeze only after:

1. held-out failures are remediated without changing Gate-1 semantics or frozen
   ground truth;
2. confidence is calibrated to evidence strength and channel availability;
3. browser accessibility semantics replace HTML-regex stand-ins where
   accessibility is claimed;
4. temporal policy handles long-lived instability and irrelevant mutation;
5. inspection freshness after relevant browser activity is resolved as a
   production dependency;
6. recorded/live read-only validation is completed;
7. production-path latency/payload is measured;
8. the final candidate reruns deterministic, held-out, temporal, privacy, and
   regression gates.
