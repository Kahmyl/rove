# F1 Gate 6 Independent Confirmatory Challenge E

## Method

Challenge E was authored only after S4R4 reached exactness on the 88-case fixed/remedial set and after the accepted S4R4 candidate/semantics hashes were frozen.

The set is property/metamorphic rather than synonym-driven. Each pair changes workflow ownership or presentation while keeping the semantic family closely related.

Challenge E is never used to patch S4R4 during this run.

## Metrics

- cases: 24
- primary accuracy: 95.83%
- macro F1: 0.968944
- risk-weighted loss: 5.937500
- high-confidence error rate: 4.35%
- critical invariant violations: 1
- proposition coverage: 100.00%
- proposition accuracy: 98.21%

## Failures

- confirme-guide-brand-auth: expected authentication_required, got ready (high), risk=142.5, critical=true.

## Freeze integrity

- S4R4 candidate/semantics unchanged: true
- Challenge E definition unchanged after freeze: true

## Acquisition

- samples: 24
- mean: 15.533 ms
- median: 13.323 ms
- p95: 16.901 ms
- max: 57.528 ms

## Confirmatory status

Independent Challenge E acceptance: false

A failure is evidence against architecture freeze and must not be repaired by changing Challenge E ground truth.
