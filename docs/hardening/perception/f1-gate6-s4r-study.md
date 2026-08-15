# F1 Gate 6 S4R Remediation Study

## Status

Research-only remediation after Challenge A falsified Gate-5 S4.

Challenge A is **not held-out anymore**. Its failure classes informed S4R.
Passing this study cannot freeze the architecture. A new Challenge B is required
after S4R is fixed.

S4R does not modify the production classifier, production browser acquisition,
protocol, runtime policy, frozen Gate-2 corpus, Gate-1 risk model, or Gates 3-5
result artifacts.

## Candidate change

S4R keeps proposition-first inference and Gate-1 precedence, but replaces the
Gate-5 literal-string/accessibility stand-ins with bounded structural-semantic
evidence:

- verification directives in presented headings;
- verification semantics correlated with the exact DOM ordinal of a
  presentation-qualified iframe;
- accessibility verification semantics only when corroborated by a presented
  frame;
- authentication headings plus credential/account-chooser structure;
- restriction/error semantics anchored in visible heading/alert surfaces or
  direct HTTP status;
- actual blocking dialog structure;
- labelled visible canvas semantics without treating pixel occupancy itself as
  interstitial evidence;
- evidence-strength confidence rules rather than support-signal count.

Quoted blocker terminology without a blocking surface is treated as ambiguity,
not as a blocker, and therefore cannot receive high-confidence blocker semantics.

## Results

| Set                     | Cases | Accuracy | Macro F1 | Mean risk | HC error | Critical | Prop coverage | Prop accuracy |
| ----------------------- | ----: | -------: | -------: | --------: | -------: | -------: | ------------: | ------------: |
| Frozen Tier A           |    22 |  100.00% | 1.000000 |     0.000 |    0.00% |        0 |       100.00% |       100.00% |
| Challenge A remediation |    12 |  100.00% | 1.000000 |     0.000 |    0.00% |        0 |       100.00% |       100.00% |

### Frozen failures

- none

### Challenge A failures

- none

## Acquisition cost

Frozen browser-acquired cases:

- mean: 21.087 ms
- p95: 29.715 ms

Challenge A:

- mean: 18.921 ms
- p95: 28.228 ms

These remain research-harness measurements, not the final production budget.

## Decision

Known-set acceptance: **true**.

S4R has recovered the frozen deterministic corpus and the now-remedial Challenge A. This is necessary but not sufficient. The next Gate-6 action is a new confirmatory Challenge B authored after this candidate, plus channel-unavailability and temporal validation using S4R.
