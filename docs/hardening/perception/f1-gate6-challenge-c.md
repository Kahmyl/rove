# F1 Gate 6 Confirmatory Challenge C

## Status

Challenge C is a post-S4R2 confirmatory set. The S4R2 candidate was hash-frozen
before the case definitions were executed and was not modified during the run.

## Results

- cases: 18
- primary accuracy: 55.56%
- macro F1: 0.583333
- risk loss: 55.500
- high-confidence error rate: 43.75%
- critical violations: 8
- proposition coverage: 100.00%
- proposition accuracy: 81.75%

Confirmatory acceptance: **false**

## Failures

- `confirmc-ready-demo-directive-near-iframe`: expected `ready`, got `human_verification` (high), risk=150, critical=true.
- `confirmc-ready-save-error-toast`: expected `ready`, got `error` (high), risk=135, critical=true.
- `confirmc-ready-plan-limit-alert`: expected `ready`, got `access_restricted` (high), risk=142.5, critical=true.
- `confirmc-ready-account-security-form`: expected `ready`, got `authentication_required` (high), risk=105, critical=true.
- `confirmc-verification-paragraph-only`: expected `human_verification`, got `ready` (high), risk=150, critical=true.
- `confirmc-verification-dialog-control`: expected `human_verification`, got `unknown_interstitial` (medium), risk=24, critical=true.
- `confirmc-verification-rich-paragraph-only`: expected `human_verification`, got `ready` (high), risk=150, critical=true.
- `confirmc-auth-passkey-wall`: expected `authentication_required`, got `ready` (high), risk=142.5, critical=true.
- `confirmc-overlap-passkey-verification`: expected `human_verification`, got `human_verification` (high), risk=0, critical=false.
- `confirmc-overlap-restriction-error`: expected `access_restricted`, got `access_restricted` (high), risk=0, critical=false.

## Candidate immutability

S4R2 unchanged during Challenge C: **true**

## Acquisition

- mean: 15.065 ms
- p95: 23.373 ms
- max: 23.373 ms

These remain research-harness measurements.

## Next decision

Challenge C falsified S4R2. Do not edit Challenge C ground truth. Remediate the architecture separately; Challenge C is now a fixed remedial set and a new independent confirmatory set will be required after remediation.
