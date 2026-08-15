# F1 Gate 6 S4R2 Surface-Gated Remediation

## Status

Research-only architecture remediation after Challenge B falsified S4R.

Challenge B is now a fixed known set. Its ground truth is unchanged.

S4R2 changes the architecture rather than extending top-level phrase matching:

1. determine whether there is a blocking/presentation-qualified surface;
2. classify semantics using direct HTTP families, control/form structure, and
   bounded semantic cues only on relevant surfaces;
3. preserve frame presentation as a separate evidence truth;
4. emit `indeterminate` when presentation evidence is unavailable;
5. derive compatibility state after propositions;
6. reserve high-confidence `ready` for complete evidence with no unresolved
   blocker proposition.

## Results

| Set           | Cases | Accuracy | Macro F1 |  Risk | HC error | Critical | Proposition accuracy |
| ------------- | ----: | -------: | -------: | ----: | -------: | -------: | -------------------: |
| Frozen Tier A |    22 |  100.00% | 1.000000 | 0.000 |    0.00% |        0 |              100.00% |
| Challenge A   |    12 |  100.00% | 1.000000 | 0.000 |    0.00% |        0 |              100.00% |
| Challenge B   |    16 |  100.00% | 1.000000 | 0.000 |    0.00% |        0 |              100.00% |

### Frozen failures

- none

### Challenge A failures

- none

### Challenge B failures

- none

## Channel degradation

- complete verification evidence correct: true
- unavailable presentation geometry -> verification indeterminate:
  true
- unavailable geometry avoids high confidence:
  true
- compatibility result is ready/non-high and therefore requires a policy gate:
  true
- accessibility unavailable still recognizes a presentation-qualified semantic
  frame:
  true

Channel acceptance: **true**

## Mutation-authorization dependency

The compatibility taxonomy has no generic stable "uncertain" state. Therefore a
stable observation may legitimately derive `ready` while a blocker proposition
is `indeterminate`.

Production authorization must not treat all `ready` assessments equally.

The implementation runbook must require mutation authorization to have:

- `kind === "ready"`;
- `confidence === "high"`;
- no unresolved blocker-evidence signal/proposition;
- a fresh inspection after decision-relevant browser activity.

This is an architecture dependency, not a reason to mislabel stable uncertainty
as `loading` or `unknown_interstitial`.

## Acquisition cost

- Frozen mean/p95: 27.474 / 42.078 ms
- Challenge A mean/p95: 24.373 / 31.690 ms
- Challenge B mean/p95: 22.045 / 36.078 ms

These are still research-harness costs.

## Next decision

Known-set acceptance: **true**

If true, S4R2 has recovered all fixed deterministic evidence and the required
channel-degradation semantics. That is still not final generalization evidence:
the next action is a new Challenge C / metamorphic confirmatory run with S4R2
frozen, followed by S4R2-specific temporal validation and runtime inspection
freshness validation.
