# F1 Gate 6 Independent Confirmatory Challenge F

## Method

Challenge F was authored only after S4R5 reached exactness on all 112 accumulated fixed/remedial cases and the S4R5 hashes were frozen.

The set is property/metamorphic. It stresses title-token role, alert ownership without relying on button count alone, modal ownership, viewport presentation, root-primary behavior, and blocker overlays above documentation.

Challenge F is not used to modify S4R5 during this run.

## Metrics

- cases: 20
- primary accuracy: 65.00%
- macro F1: 0.659167
- risk-weighted loss: 49.875000
- high-confidence error rate: 35.00%
- critical invariant violations: 7
- proposition coverage: 100.00%
- proposition accuracy: 85.00%

## Failures

- confirmf-reference-brand-auth: expected authentication_required, got ready (high), risk=142.5, critical=true.
- confirmf-docs-brand-auth: expected authentication_required, got ready (high), risk=142.5, critical=true.
- confirmf-tutorial-brand-auth: expected authentication_required, got ready (high), risk=142.5, critical=true.
- confirmf-handbook-brand-auth: expected authentication_required, got ready (high), risk=142.5, critical=true.
- confirmf-chapter-brand-auth: expected authentication_required, got ready (high), risk=142.5, critical=true.
- confirmf-readonly-local-restriction-alert: expected ready, got access_restricted (high), risk=142.5, critical=true.
- confirmf-root-auth-with-brand-token: expected authentication_required, got ready (high), risk=142.5, critical=true.

## Freeze integrity

- S4R5 candidate/semantics unchanged: true
- Challenge F definition unchanged: true

## Acquisition

- samples: 20
- mean: 14.284 ms
- median: 13.280 ms
- p95: 14.082 ms
- max: 32.246 ms

## Confirmatory status

Independent Challenge F acceptance: false

If false, the failure is remedial evidence; Challenge F ground truth remains frozen.
