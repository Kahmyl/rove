# F1 Gate 4 Evidence Research

## Status

Gate 4 experimental evidence study.

This gate does **not** change the production classifier, production
`PlaywrightBrowserSession.inspect()` acquisition path, protocol, runtime
mutation policy, Gate-1 risk model, Gate-2 corpus ground truth, or Gate-3
baseline artifacts.

Source checkpoint:

```text
bdb0d1622e50b70013e2404235f2d25a74fa0840
```

Environment:

- Node: `v22.22.0`
- Playwright: `1.62.1`
- Chromium: `151.0.7922.34`
- stable-case repeats: 3
- stabilization repeats: 3

## Research questions

Gate 4 asks:

1. when is a browser observation stable enough to compare;
2. which bounded evidence channels distinguish presentation from mere provider
   presence;
3. what do those channels cost in latency and payload;
4. which channels are redundant or insufficient in isolation;
5. which evidence can be persisted without carrying raw page/user content.

It does **not** choose the final semantic inference strategy. That remains Gate
5.

## Stabilization study

The three Tier-A temporal fixtures all mutate 250 ms after their initial
document state. The reference signature is captured 50 ms after each scenario's
last declared checkpoint.

Each policy is run 3 times per scenario.

| Policy | Scenarios matching reference in every repeat | Mean observation time (ms) |
| --- | ---: | ---: |
| `load-only` | 0/3 | 9.856 |
| `fixed-100` | 0/3 | 101.667 |
| `fixed-250` | 0/3 | 255.000 |
| `fixed-350` | 3/3 | 353.178 |
| `floor-200-quiet-100` | 0/3 | 208.744 |
| `floor-300-quiet-75` | 3/3 | 338.567 |

The lowest-latency tested policy that matched every synthetic reference in every repeat was `floor-300-quiet-75` at 338.567 ms mean browser-relative observation time. This is a fixture result, **not** a production timing recommendation.

The important conclusion is not a magic timeout. It is that `load` or a short
fixed wait is not evidence that the user-facing state has stabilized. A delayed
DOM transition can occur after both DOMContentLoaded and load.

Gate 5/6 should therefore treat stabilization as an observation policy with a
bounded maximum, not as a synonym for `document.readyState`.

## Evidence channels

The research collector persists bounded facts only:

- document readiness and structural counts;
- hashes and lengths instead of raw visible text/title;
- frame parent/depth, scheme/origin, CSS state, geometry, viewport intersection,
  ancestor clipping, and bounded topmost-point sampling;
- accessibility snapshot hash/size and role counts, not raw accessible text;
- bounded lifecycle/network metadata containing method/resource type/status,
  origin, frame depth, and timing;
- no request/response bodies, headers, cookies, storage, typed values, raw HTML,
  screenshots, or unsanitized URLs.

The runtime probe confirmed that the installed Playwright exposes ARIA
snapshots, geometry, visibility, frame relationships, and lifecycle events, so
the experiment does not require CDP-only collection.

## Presentation ablation

Reference: `human-verification-visible`.

Adversaries:

- `ready-hidden-recaptcha-empty`
- `ready-opacity-zero-recaptcha-empty`
- `ready-offscreen-recaptcha-empty`
- `ready-one-pixel-recaptcha-empty`
- `ready-clipped-recaptcha-empty`
- `ready-provider-behind-modal`

Coverage means the channel differs from the truly presented reference on that
adversary. It is **not** primary-state accuracy and is not a final classifier.

| Channel/fact family | Adversaries distinguished |
| --- | ---: |
| `framePresence` | 0/6 |
| `subframeNetworkPresence` | 0/6 |
| `accessibilityIframePresence` | 1/6 |
| `css` | 2/6 |
| `viewport` | 2/6 |
| `area` | 2/6 |
| `clipping` | 2/6 |
| `occlusion` | 1/6 |
| `combinedGeometry` | 6/6 |

The combined geometry/presentation facts distinguish all six deterministic passive-frame adversaries from the presented verification reference.

Frame presence and subframe network activity are measured separately because
Gate 1 explicitly says provider frame/network presence alone cannot establish
human verification.

Accessibility is also measured separately. An accessibility tree can contain
offscreen or otherwise non-presented semantic content, so accessibility remains
useful semantic evidence but is not treated as a visibility oracle.

## Cost against Gate 3

Gate-3 real `browser.inspect()` baseline:

- mean total inspect latency: 2.916 ms;
- p95 total inspect latency: 3.451 ms;
- mean inspection payload: 640.048 bytes.

Gate-4 research collector on stabilized deterministic fixtures:

- mean bounded evidence acquisition: 17.215 ms;
- p95 bounded evidence acquisition: 20.212 ms;
- mean frame-geometry acquisition: 10.912 ms;
- mean accessibility acquisition: 2.543 ms;
- mean bounded evidence payload: 2502.175 bytes;
- p95 bounded evidence payload: 3192.000 bytes.

These costs are research measurements. Gate 4 does not automatically move every
channel onto the production default path.

## Channel interpretation

### Frame/network presence

Useful for structural context and provider integration observation, but
insufficient for "presented now" semantics.

### CSS + geometry

Directly measures several distinctions frozen in Gate 1:

- hidden/display-none;
- opacity zero;
- offscreen;
- tiny/effectively 1x1;
- ancestor clipping;
- occlusion by the current topmost surface.

This is the strongest deterministic evidence family for the five frozen false
human-verification handoffs plus the existing occlusion adversary.

### Accessibility

Useful for role/name semantics and potentially for authentication or challenge
instructions. It must remain bounded and value-safe, and it must be combined
with presentation evidence when the proposition requires something to be
currently visible/presented.

### Lifecycle/network

Useful for stabilization, navigation status, frame relationships, failures, and
corroboration. It is not sufficient by itself for semantic blocker inference.

## Privacy result

The committed result contains no raw HTML, full body text, raw accessibility
snapshot, request/response bodies or headers, cookies, storage, credentials,
typed values, or unsanitized URL fields.

Synthetic fixtures permit richer data under Gate 1, but Gate 4 deliberately
uses the stricter bounded representation so the collector design does not depend
on persisting raw external content later.

## Gate 4 boundary

Gate 4 intentionally does **not**:

- modify `classifyPageState()`;
- modify `PlaywrightBrowserSession.inspect()`;
- add a production page-state protocol;
- add screenshot/OCR evidence;
- choose confidence rules;
- choose final proposition inference thresholds;
- choose a production stabilization timeout.

Those decisions belong to Gate 5 and Gate 6 after the evidence results are
reviewed.

## Gate 5 input

Gate 5 should compare inference strategies using the Gate-4 evidence, with
particular attention to:

1. proposition-first inference rather than a single flat ruleset;
2. human-verification requiring both semantic challenge evidence and current
   presentation evidence;
3. overlap precedence from Gate 1;
4. bounded escalation to visual/OCR evidence only where structural channels are
   genuinely ambiguous;
5. comparison against the frozen Gate-3 risk and accuracy baseline.
