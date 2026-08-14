# F1 Gate 6 S4R3 Workflow-Scope Remediation

## Architecture

S4R3 is a separate research candidate created after Challenge C falsified S4R2.

The key change is semantic scope:

- meta/documentation content is distinguished from the active workflow;
- blocking dialogs are distinguished from ordinary visible content;
- local alerts/banners are distinguished from workflow-level failure surfaces;
- settings forms are distinguished from authentication gates;
- paragraph-level verification directives can establish an active blocker;
- passkey-only identity gates can establish authentication;
- frame semantic identity remains separate from frame presentation evidence;
- propositions remain independent and overlap is preserved.

No production classifier/runtime file is changed by this study.

## Results

| Set           | Cases | Accuracy | Macro F1 |  Risk | HC error | Critical | Proposition accuracy |
| ------------- | ----: | -------: | -------: | ----: | -------: | -------: | -------------------: |
| Frozen Tier A |    22 |  100.00% | 1.000000 | 0.000 |    0.00% |        0 |              100.00% |
| Challenge A   |    12 |  100.00% | 1.000000 | 0.000 |    0.00% |        0 |              100.00% |
| Challenge B   |    16 |  100.00% | 1.000000 | 0.000 |    0.00% |        0 |              100.00% |
| Challenge C   |    18 |  100.00% | 1.000000 | 0.000 |    0.00% |        0 |              100.00% |

### Frozen failures

- none

### Challenge A failures

- none

### Challenge B failures

- none

### Challenge C failures

- none

## Channel degradation

- complete semantic-frame verification correct: true
- unavailable frame geometry -> proposition indeterminate: true
- unavailable frame geometry avoids high confidence: true
- compatibility ready/medium requires a later policy gate: true

Channel acceptance: **true**

## Known-set status

Exact across all 68 fixed deterministic cases plus channel degradation: **true**

If this is true, S4R3 must be frozen before any new confirmatory Challenge D is authored or executed. Challenge C is remedial evidence and no longer qualifies as independent confirmation.

## Still outstanding

- independent Challenge D after S4R3 freeze;
- S4R3-specific decision-relevant temporal validation;
- runtime activity-to-inspection invalidation validation;
- mutation authorization for low/medium-confidence ready and unresolved evidence;
- production-path acquisition/latency/payload measurement;
- recorded/live Tier C/D validation where privacy-safe;
- final ADR/runbook and production integration.
