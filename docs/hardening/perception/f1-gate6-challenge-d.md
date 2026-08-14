# F1 Gate 6 Independent Confirmatory Challenge D

## Purpose

Challenge D was authored only after S4R3 reached exactness on the fixed 68-case known set and after the accepted S4R3 candidate/semantics hashes were frozen.

Challenge D specifically pressures semantic-scope composition:

- blocker-like copy in nonblocking footers, sidebars, alerts, and partial-feature cards;
- real blockers layered over documentation or settings pages;
- restriction/error semantics in blocking dialogs;
- whole-document blocker surfaces without `main` or `role=alert`;
- product/company names that contain meta-context words such as “Example” or “Demo”;
- overlapping authentication and HTTP restriction;
- unknown modal interstitial preservation.

No Challenge D result is used to patch S4R3 during this run.

## Metrics

- cases: 20
- primary accuracy: 35.00%
- macro F1: 0.291667
- risk-weighted loss: 64.125000
- high-confidence error rate: 60.00%
- critical invariant violations: 12
- proposition coverage: 100.00%
- proposition accuracy: 79.29%

## Failures

- `confirmd-ready-footer-verification-sample`: expected `ready`, got `human_verification` (high); risk=150; critical=true.
- `confirmd-ready-optional-signin-sidebar`: expected `ready`, got `authentication_required` (high); risk=105; critical=true.
- `confirmd-ready-partial-restriction-card`: expected `ready`, got `access_restricted` (high); risk=142.5; critical=true.
- `confirmd-ready-local-error-card`: expected `ready`, got `error` (high); risk=135; critical=true.
- `confirmd-auth-modal-over-settings`: expected `authentication_required`, got `unknown_interstitial` (medium); risk=24; critical=true.
- `confirmd-auth-modal-over-docs`: expected `authentication_required`, got `unknown_interstitial` (medium); risk=24; critical=true.
- `confirmd-restriction-modal-over-app`: expected `access_restricted`, got `unknown_interstitial` (medium); risk=30; critical=true.
- `confirmd-error-modal-over-app`: expected `error`, got `unknown_interstitial` (medium); risk=42; critical=true.
- `confirmd-restriction-root-surface`: expected `access_restricted`, got `ready` (high); risk=150; critical=true.
- `confirmd-error-root-surface`: expected `error`, got `ready` (high); risk=142.5; critical=true.
- `confirmd-auth-example-company`: expected `authentication_required`, got `ready` (high); risk=142.5; critical=true.
- `confirmd-auth-demo-company`: expected `authentication_required`, got `ready` (high); risk=142.5; critical=true.
- `confirmd-overlap-auth-restriction-settings`: expected `authentication_required`, got `access_restricted` (high); risk=52.5; critical=false.

## Acquisition

- sample count: 20
- mean: 13.524 ms
- median: 12.963 ms
- p95: 17.839 ms
- max: 19.497 ms

## Freeze integrity

S4R3 candidate/semantics unchanged during Challenge D: **true**

## Confirmatory status

Challenge D acceptance: **false**

A failure is evidence against freezing the architecture and must not be remediated by changing Challenge D ground truth.
