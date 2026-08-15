# F1 Gate 6 S4R4 Surface-Ownership Remediation

## Architecture

S4R4 is a separate research candidate created after independent Challenge D falsified S4R3.

The key change is explicit surface ownership:

- primary workflow, blocking-dialog, alert, and supplementary surfaces are collected separately;
- semantic cues are evaluated within their owning surface instead of promoted page-globally;
- documentation/settings context on the primary surface cannot veto a blocking dialog above it;
- supplementary footer/sidebar/card copy cannot become a workflow blocker by vocabulary alone;
- when no `main` exists, the document body becomes the primary surface;
- HTTP blocker evidence remains independent so overlapping propositions are preserved;
- frame semantic identity remains separate from frame presentation evidence.

Challenge D remains hash-frozen remedial evidence. No production classifier/runtime file is changed by this study.

## Results

| Set           | Cases | Accuracy | Macro F1 |  Risk | HC error | Critical | Proposition accuracy |
| ------------- | ----: | -------: | -------: | ----: | -------: | -------: | -------------------: |
| Frozen Tier A |    22 |  100.00% | 1.000000 | 0.000 |    0.00% |        0 |              100.00% |
| Challenge A   |    12 |  100.00% | 1.000000 | 0.000 |    0.00% |        0 |              100.00% |
| Challenge B   |    16 |  100.00% | 1.000000 | 0.000 |    0.00% |        0 |              100.00% |
| Challenge C   |    18 |  100.00% | 1.000000 | 0.000 |    0.00% |        0 |              100.00% |
| Challenge D   |    20 |  100.00% | 1.000000 | 0.000 |    0.00% |        0 |              100.00% |

### Frozen failures

- none

### Challenge A failures

- none

### Challenge B failures

- none

### Challenge C failures

- none

### Challenge D failures

- none

## Channel degradation

- complete semantic-frame verification correct: true
- unavailable frame geometry -> proposition indeterminate: true
- unavailable frame geometry avoids high confidence: true
- compatibility ready/medium requires a later policy gate: true

Channel acceptance: **true**

## Known-set status

Exact across all 88 fixed/remedial deterministic cases plus channel degradation: **true**

If this is true, S4R4 must be frozen before any new confirmatory Challenge E is authored or executed. Challenge D is remedial evidence and no longer qualifies as independent confirmation.

## Still outstanding

- independent Challenge E after S4R4 freeze;
- S4R4-specific decision-relevant temporal validation;
- runtime activity-to-inspection invalidation validation;
- mutation authorization for low/medium-confidence ready and unresolved evidence;
- production-path acquisition/latency/payload measurement;
- recorded/live Tier C/D validation where privacy-safe;
- final ADR/runbook and production integration.
