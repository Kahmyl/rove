# F1 Gate 6 Confirmatory Challenge B

## Status

Post-remediation confirmatory validation of S4R.

Challenge B was authored after S4R reached 100% primary-state and proposition
accuracy on the frozen Tier-A corpus and Challenge A. S4R is treated as frozen
during this experiment.

## Confirmatory set

- cases: 16
- primary accuracy: 25.00%
- macro F1: 0.217949
- mean risk loss: 90.094
- high-confidence error rate: 76.92%
- critical invariant violations: 10
- proposition coverage: 100.00%
- proposition accuracy: 74.11%

Confirmatory acceptance: **false**

### Failures

- `confirm-ready-security-challenge-tutorial-heading`: expected `ready`, got `human_verification` (high), risk=150, critical=true.
- `confirm-ready-error-troubleshooting-heading`: expected `ready`, got `error` (high), risk=135, critical=true.
- `confirm-verification-robot-modal`: expected `human_verification`, got `unknown_interstitial` (medium), risk=24, critical=true.
- `confirm-verification-robot-frame-only`: expected `human_verification`, got `ready` (medium), risk=120, critical=true.
- `confirm-auth-unlock-session-form`: expected `authentication_required`, got `ready` (high), risk=142.5, critical=true.
- `confirm-auth-select-identity`: expected `authentication_required`, got `ready` (high), risk=142.5, critical=true.
- `confirm-restriction-http-451`: expected `access_restricted`, got `ready` (high), risk=150, critical=true.
- `confirm-restriction-network-suspended`: expected `access_restricted`, got `ready` (high), risk=150, critical=true.
- `confirm-error-http-404-not-found`: expected `error`, got `ready` (high), risk=142.5, critical=true.
- `confirm-error-hit-a-snag`: expected `error`, got `ready` (high), risk=142.5, critical=true.
- `confirm-overlap-error-robot-verification`: expected `human_verification`, got `error` (high), risk=90, critical=false.
- `confirm-overlap-auth-restriction`: expected `authentication_required`, got `access_restricted` (high), risk=52.5, critical=false.

## Evidence-unavailability probe

A known presented human-verification frame is classified under three acquisition
conditions:

- complete evidence correct: true
- geometry unavailable emits `humanVerificationPresented = indeterminate`:
  false
- geometry-unavailable result avoids high confidence:
  true
- accessibility unavailable still recognizes the exact presented semantic frame:
  true

Gate 1 permits proposition truth to be `indeterminate`. Collector failure must
not silently become semantic `false`.

Channel-availability acceptance: **false**

## Acquisition cost

- mean: 15.273 ms
- p95: 31.205 ms
- max: 31.205 ms

These are research-harness measurements, not yet the final production budget.

## Candidate immutability

S4R source unchanged during Challenge B: **true**

## Freeze implication

Challenge B and/or the channel-degradation probe falsified the current S4R freeze candidate. Do not modify Challenge B ground truth. Remediate the architecture separately, then rerun the frozen corpus, Challenge A, and this now-fixed Challenge B before authoring any additional confirmatory set.
