# Phase 3 Caller-Visible Visual Evidence Qualification

## Decision

**ADOPT**

Date: 2026-09-05

Phase 3 accepts the existing Rove screenshot path as the caller-visible visual
evidence mechanism.

No additional Phase 3 production browser implementation is required to deliver
visual evidence to a compatible vision-capable calling agent.

The experiment does not authorize screenshot coordinates as independent browser
action authority.

## Repository state qualified

The experiment qualified Rove at:

- branch: `feature/browser-perception-interaction`;
- HEAD: `55b63a8a31141244f7154c496331c4968711e822`.

No production Rove source or dependency change was permitted during the
experiment.

The qualification therefore evaluates the screenshot and interaction contracts
that already existed at that HEAD.

## Hypothesis

The mandatory Phase 3 experiment tested whether the existing
`browser.screenshot` path could:

1. capture current rendered browser state through Playwright;
2. bind that capture to an exact current `BrowserObservation`;
3. return the capture through MCP as actual image content;
4. place that image into the calling agent's model context;
5. allow the caller to recover information available only in rendered pixels;
6. preserve Rove's existing target and interaction authority.

## Caller qualification

The successful run used the normal desktop caller environment.

Observed caller metadata:

- desktop host: ChatGPT macOS application;
- host version: `26.901.31953`;
- host build: `7868`;
- caller surface: Codex functionality hosted by the desktop application;
- configured model: `gpt-5.6-sol`;
- Rove MCP transport: HTTP on localhost port `47821`, path `/mcp`;
- authentication: bearer authentication;
- authentication behavior was independently qualified before the visual run.

The bearer credential itself is intentionally not recorded in this repository.

## MCP image delivery qualification

The caller session recorded a completed `browser.screenshot` MCP tool call.

The Rove MCP result contained:

- `content[0].type = text`;
- `content[1].type = image`;
- `content[1].mimeType = image/png`.

The caller subsequently represented the tool output to the model as:

- `input_text`;
- `input_text`;
- `input_image`.

This distinction matters.

A byte-valid PNG alone would not prove caller-visible vision. The observed
`input_image` conversion, followed by correct recovery of randomized
pixel-only facts, demonstrates that the screenshot reached the calling model as
actual visual context.

## Fixture

The disposable fixture rendered information into a canvas so that the tested
answers were not available through ordinary DOM or accessibility text.

Each randomized run contained:

- a visual nonce;
- a rendered label;
- two shapes with a randomized spatial relationship;
- one ordinary semantic browser control.

Required run count: 10.

## Visual correctness result

The independent verifier reported:

- submitted runs: 10;
- passed runs: 10;
- required runs: 10;
- complete: true;
- allPassed: true.

Field-level result:

- visual nonce: 10/10 correct;
- rendered label: 10/10 correct;
- spatial relationship: 10/10 correct.

The caller-reported values accepted by the verifier were:

| Run | Observed nonce | Observed relation | Observed label | Verifier |
| --- | --- | --- | --- | --- |
| run-01 | `VIS-N763GKA4` | `below` | `LBL-5HVWUK9` | pass |
| run-02 | `VIS-2UMGHDMN` | `right_of` | `LBL-S9449YG` | pass |
| run-03 | `VIS-UFEKEA2U` | `left_of` | `LBL-HHUDNAL` | pass |
| run-04 | `VIS-NZ6WQCP3` | `below` | `LBL-QNLRVCZ` | pass |
| run-05 | `VIS-T8XPPHYR` | `below` | `LBL-TANG22N` | pass |
| run-06 | `VIS-CLV5KQLZ` | `below` | `LBL-PJUEAGR` | pass |
| run-07 | `VIS-5VXUUEAB` | `above` | `LBL-U2PHLVC` | pass |
| run-08 | `VIS-XKW954RH` | `left_of` | `LBL-B7A56Z6` | pass |
| run-09 | `VIS-PH84YWZL` | `above` | `LBL-3FSTCZQ` | pass |
| run-10 | `VIS-SZGCNKMX` | `right_of` | `LBL-XHWSR7H` | pass |

For every run, the verifier independently returned:

- `nonceCorrect: true`;
- `labelCorrect: true`;
- `relationCorrect: true`;
- `correct: true`.

## Observation and evidence correlation

All ten captures were viewport screenshots.

All ten were:

- MIME type `image/png`;
- width `1200`;
- height `762`;
- correlated to the exact caller-reported source observation.

| Run | Source observation | Evidence | Bytes |
| --- | --- | --- | ---: |
| run-01 | `bobs_9ea13779e114401495f4df5b58458566` | `ev_5f2d5c0d787a4284bd03af0520c2a8ff` | 153336 |
| run-02 | `bobs_d56479ad085b4ccea1f27ba8f477e540` | `ev_0315de790cd3470eab2e0f253338f1e3` | 151248 |
| run-03 | `bobs_49fa6ded45e64795b9636bd8a65f1ed5` | `ev_936ada3c8d91415f84d6f57115cd5990` | 146045 |
| run-04 | `bobs_db931f98f6854d9d88cf6630ca7a6494` | `ev_72c42208073940d5ab0be0ece424902e` | 153690 |
| run-05 | `bobs_496b65e56021488cb6ccfabd0284a668` | `ev_9b6217fabedb456987f4e7609a6d7df8` | 149882 |
| run-06 | `bobs_8dd2b007adb8498d9a1bbc60ab9474ea` | `ev_c9909734f2a34351a02de64b310becea` | 148172 |
| run-07 | `bobs_9368844d8b8d4716bf83788caf39f724` | `ev_7c9eb5c3c0d948c98fe05a09fccf8a0f` | 149739 |
| run-08 | `bobs_961fe309222d41ef81c94c8cb379e154` | `ev_9ee40fafe8d74a2a9bc79295febdcea7` | 152926 |
| run-09 | `bobs_c26b64038179470aa8d2a8707c671536` | `ev_e264218710474bb89ca0d4c86a30b627` | 152855 |
| run-10 | `bobs_75bfb3b50ccd406f8d2ee121cdcf3cbf` | `ev_ae6bd31469d449f88a5f218dbe50bc06` | 152709 |

Observation-to-evidence correlation result: 10/10.

Silent image drops: 0.

## Semantic action-authority check

The semantic-control case proved that visual evidence did not replace Rove
interaction authority.

The caller:

- used `browser.resolve_target`;
- used `browser.interact`;
- observed the expected effect;
- did not use screenshot coordinates as independent action authority.

Result:

`screenshot_derived_independent_action_authority = 0`

## Stale visual-authority check

The stale-evidence case retained an old observation, mutated the rendered
surface through a grounded Rove interaction, and then attempted to use the old
observation for a screenshot request.

Rove rejected the stale observation.

Result:

`stale_visual_authority_acceptance = 0`

## Success thresholds

The frozen success thresholds were:

- visual nonce correct: 10/10;
- spatial relation correct: 10/10;
- rendered label correct: 10/10;
- silent image drops: 0;
- stale visual-authority acceptance: 0;
- screenshot-derived independent action authority: 0.

Every threshold passed.

## Architecture decision

Phase 3 adopts this architecture:

Browser structured perception remains the normal first-line perception path.

When rendered meaning remains unclear, the same calling agent may explicitly
request current screenshot evidence through `browser.screenshot`.

The calling agent owns visual interpretation.

Rove continues to own:

- session identity;
- page identity;
- document and revision identity;
- target identity;
- target freshness;
- Playwright dispatch;
- successor observations;
- effect verification;
- action receipts;
- consequential replay fencing;
- human-control transitions.

A screenshot remains evidence, not independent action authority.

## Explicitly not adopted

Phase 3 does not add:

- OCR;
- Tesseract;
- an internal multimodal model;
- a model-vision provider abstraction;
- automatic screenshot routing;
- a second browser-perception subsystem;
- unrestricted page-wide coordinate clicking;
- raw CDP action dispatch;
- Set-of-Mark production annotation.

OCR remains a possible future experiment only if measured failures justify it.

## Coordinate interaction boundary

Phase 2 already exposes `coordinate_click`, but this experiment did not qualify
it as visual-only mutation authority.

Its current target and observation requirements remain useful constraints, but
a separate isolated experiment is still required before Rove may claim that
effective coordinate offsets cannot escape the intended current visual
surface.

Until then, genuine visual-only mutation that lacks a qualified Rove target
remains a human-control case.

## Phase 3 outcome

The mandatory caller-visible visual-perception gate is satisfied.

The existing Phase 1 screenshot implementation is sufficient for Phase 3's
visual-evidence transport.

The existing Phase 2 authority model remains intact.

Therefore the Phase 3 decision is **ADOPT**, with no additional production
browser implementation required for this capability.
