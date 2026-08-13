# F1 Gate 3 Frozen Baseline

## Status

Frozen pre-fix baseline for F1 browser perception.

The source revision is:

```text
96e90a13b931e4b1dd0e13a053a3f71225d1bfd1
```

This baseline was captured **before any F1 classifier or acquisition fixes**.

Gate 4 and Gate 5 may add experimental evidence and inference strategies, but
they must compare against these frozen results. If the Gate 1 risk model or
Gate 2 corpus changes, the change-control rules in the research contract apply.

## Frozen implementation fingerprints

| Input                           | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `page-state-classifier.ts`      | `326c5d1054b7f3c6d47041e9449fea5a9c07f7a3f946cd84dac4d2b4f88b05a7` |
| `playwright-browser-session.ts` | `85546894e68c3f651df693161193a0afb3cced59ac77192c85d414fa1a380d40` |
| Tier-A local corpus             | `9d704a3266b714b2206b949e43ff370b7260486288e851484e090e7b154d947a` |
| Gate-1 risk model               | `901db0f76e44dba6dcbcf4abff0e13649a4d36053e4bf9f1161623232ba14a4b` |
| Gate-3 browser-inspect runner   | `69706145aed3facee3257a7339d96cc479e8185637b0e2ff27d4fc4e095fa66f` |
| `pnpm-lock.yaml`                | `42ab6b80765e31a6d4ce9a48b0f4504a2764c5208024fd1f05c07428602e6417` |

Environment:

- Node: `v22.22.0`
- Platform: `darwin/arm64`
- Playwright: `1.62.1`
- Chromium: `151.0.7922.34`

## Baseline A — pure current classifier

Artifact:

```text
docs/hardening/perception/baselines/f1-gate3-pure-classifier.json
```

Scope: all 22 deterministic Tier-A direct-signal cases,
including the signal-only unstable/loading case.

| Metric                        |  Frozen value |
| ----------------------------- | ------------: |
| Primary-state accuracy        |        72.73% |
| Disposition accuracy          |        77.27% |
| Macro F1                      |      0.866146 |
| Mean risk-weighted loss       |     36.818182 |
| Total risk-weighted loss      |       810.000 |
| High-confidence error rate    |        30.00% |
| Critical invariant violations |             5 |
| Unknown rate                  |         4.55% |
| Proposition coverage          |         0.00% |
| Mean inference latency        |      0.018 ms |
| P95 inference latency         |      0.069 ms |
| Mean direct evidence size     | 732.227 bytes |

### Pure-classifier mismatches

| Case                                 | Expected             | Actual               | Confidence | Expected action | Actual action   | Risk | Critical invariant |
| ------------------------------------ | -------------------- | -------------------- | ---------- | --------------- | --------------- | ---: | ------------------ |
| `ready-hidden-recaptcha-empty`       | `ready`              | `human_verification` | high       | `continue`      | `request_human` |  150 | yes                |
| `ready-opacity-zero-recaptcha-empty` | `ready`              | `human_verification` | high       | `continue`      | `request_human` |  150 | yes                |
| `ready-offscreen-recaptcha-empty`    | `ready`              | `human_verification` | high       | `continue`      | `request_human` |  150 | yes                |
| `ready-one-pixel-recaptcha-empty`    | `ready`              | `human_verification` | high       | `continue`      | `request_human` |  150 | yes                |
| `ready-clipped-recaptcha-empty`      | `ready`              | `human_verification` | high       | `continue`      | `request_human` |  150 | yes                |
| `overlap-restriction-verification`   | `human_verification` | `access_restricted`  | high       | `request_human` | `request_human` |   60 | no                 |

## Baseline B — real `browser.inspect()` path

Artifact:

```text
docs/hardening/perception/baselines/f1-gate3-browser-inspect.json
```

Scope: 21 pipeline-eligible deterministic Tier-A
cases. The signal-only unstable/loading snapshot is excluded because Gate 2
intentionally did not pretend a completed navigation can reproduce an unstable
observation point.

The latency measurement starts immediately before
`PlaywrightBrowserSession.inspect()` and excludes navigation time.

The frozen production API does not expose acquisition and classifier inference
as separately timed phases. Gate 3 therefore records this as total
`browser.inspect()` wall time and does **not** fabricate an acquisition/inference
decomposition. Gate 4 may instrument experimental collectors to study those
components independently.

| Metric                        |   Frozen value |
| ----------------------------- | -------------: |
| Primary-state accuracy        |         71.43% |
| Disposition accuracy          |         76.19% |
| Macro F1                      |       0.843838 |
| Mean risk-weighted loss       |      38.571429 |
| Total risk-weighted loss      |        810.000 |
| High-confidence error rate    |         31.58% |
| Critical invariant violations |              5 |
| Unknown rate                  |          4.76% |
| Proposition coverage          |          0.00% |
| Mean total inspect latency    |       2.916 ms |
| P95 total inspect latency     |       3.451 ms |
| Mean inspection payload       |  640.048 bytes |
| P95 inspection payload        | 1289.000 bytes |

### Real-inspection mismatches

| Case                                 | Expected             | Actual               | Confidence | Expected action | Actual action   | Risk | Critical invariant |
| ------------------------------------ | -------------------- | -------------------- | ---------- | --------------- | --------------- | ---: | ------------------ |
| `ready-hidden-recaptcha-empty`       | `ready`              | `human_verification` | high       | `continue`      | `request_human` |  150 | yes                |
| `ready-opacity-zero-recaptcha-empty` | `ready`              | `human_verification` | high       | `continue`      | `request_human` |  150 | yes                |
| `ready-offscreen-recaptcha-empty`    | `ready`              | `human_verification` | high       | `continue`      | `request_human` |  150 | yes                |
| `ready-one-pixel-recaptcha-empty`    | `ready`              | `human_verification` | high       | `continue`      | `request_human` |  150 | yes                |
| `ready-clipped-recaptcha-empty`      | `ready`              | `human_verification` | high       | `continue`      | `request_human` |  150 | yes                |
| `overlap-restriction-verification`   | `human_verification` | `access_restricted`  | high       | `request_human` | `request_human` |   60 | no                 |

## Direct-vs-acquisition differences

The following table isolates cases where the current pure classifier result
from the authored direct signals differs from the result obtained after the
same fixture passes through the real browser acquisition path.

_The paired pipeline cases produced the same primary state and disposition in direct and real-inspection measurement._

This distinction matters because an apparent classifier problem may actually be
an acquisition/evidence problem, and an apparent acquisition problem may be
hidden when only hand-authored signals are benchmarked.

## Proposition baseline

Both current baselines intentionally report zero proposition coverage because
the current production classifier emits only the compatibility
`PageStateAssessment`.

Gate 3 does **not** reverse-engineer propositions from the primary label. Doing
so would fabricate evidence and contaminate later proposition-aware strategy
comparisons.

## Gate 3 interpretation rules

These numbers are descriptive, not a request to repair the implementation in
this gate.

In particular:

1. no classifier rule is changed in Gate 3;
2. no acquisition collector is added or removed in Gate 3;
3. no fixture expectation is changed in response to poor baseline results;
4. no Gate-1 risk cost is changed in response to poor baseline results;
5. no acceptance threshold is relaxed;
6. later strategies must compare against the committed JSON artifacts, not a
   remembered or regenerated number.

## Next gate

Gate 4 studies evidence and acquisition:

- stabilization;
- structured frame evidence;
- accessibility evidence;
- navigation/network metadata;
- geometry and visibility;
- temporal signals;
- ablations;
- latency, payload, and privacy cost.

Classifier fixes remain deferred until the evidence research establishes which
signals are actually justified.
