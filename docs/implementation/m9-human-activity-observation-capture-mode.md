# Milestone 9 — Human Activity Observation & Capture Mode

Milestone 9 completes Rove's human-first Capture Mode workflow.

Capture Mode begins under human control. Rove observes a minimized representation of the human browser journey while agent browser mutation remains disabled.

## Observation model

The browser emits actor-neutral activity through `BrowserSession.onActivity()`.

The runtime persists that activity as actor `human` only while the persisted session is active and controlled by the human.

Lifecycle activity includes:

- `navigation_completed`
- `url_changed`
- `page_title_changed`
- `page_opened`
- `page_switched`

Normalized human interaction activity includes:

- `human_click`
- `human_submit`
- `human_scroll`
- `human_selection`

Observation sequence numbers remain append-only and monotonically increasing.

## Privacy

Rove does not record raw cursor movement or pointer coordinates.

Human interaction payloads are minimized before persistence.

Clicks retain safe semantic metadata such as tag, role, and label.

Form submissions retain safe form metadata such as form ID and method.

Scroll activity is limited to the fixed milestones:

- 25
- 50
- 75
- 100

Selections retain semantic metadata and selected index rather than the selected value.

Raw typed values and password contents are not persisted through the human-activity channel.

## Human tab switching

DOM focus and visibility are not used as the source of truth for tab selection.

Real headed Chromium testing showed multiple Playwright pages could simultaneously report visible and focused state.

Rove therefore reconciles the selected browser tab using a browser-level CDP session.

Chromium `tab` targets expose `embedderData.tabActive`. Rove reads that state and maps the active tab back to its stable `page_01`, `page_02`, and later page identities.

Resolution prefers:

1. unique URL and title;
2. unique URL;
3. tab strip index as a fallback.

CDP target IDs are not persisted as Rove page identity.

A real human tab change produces a normalized `page_switched` observation.

## Capture Mode control

Capture Mode remains human-owned.

Agent mutation attempts are rejected with:

`CONTROL_NOT_OWNED`

Read-only MCP access remains available for session status, observations, and evidence.

The MCP adapter does not expose human take or return control operations.

## Electron Companion

The Companion discovers active Companion and Capture sessions.

For Capture Mode:

- the session remains human-controlled;
- Take Control is unavailable;
- Return Control is unavailable;
- observation and evidence counts remain visible;
- Finish Session remains available.

Finishing the session transitions it to `completed` with no controller.

## Automated verification

Milestone 9 covers:

- human navigation;
- URL and title changes;
- normalized clicks;
- safe form submission;
- fixed scroll milestones;
- normalized selection;
- page opening;
- real tab switching;
- observation ordering;
- human actor attribution;
- sensitive values absent from persistence;
- Capture Mode mutation blocking;
- Companion Capture discovery.

Final repository gates are:

`pnpm lint`

`pnpm typecheck`

`pnpm test`

`pnpm build`

`git diff --check`

## Manual verification

Run the runtime headed with a dedicated Rove home and a deterministic local fixture.

During the Capture session:

1. navigate to the fixture;
2. enter a known test password;
3. perform a meaningful click;
4. change a safe selection;
5. submit the safe fixture form;
6. scroll through the page;
7. open another tab;
8. switch manually between tabs;
9. finish the session.

The resulting journey should contain the applicable:

- `navigation_completed`
- `url_changed`
- `page_title_changed`
- `human_click`
- `human_submit`
- `human_selection`
- `human_scroll`
- `page_opened`
- `page_switched`

The completed session must have status `completed` and controller `null`.

The exact test password must have zero matches anywhere under the dedicated Rove home.

A real MCP mutation attempt during Capture Mode must return `CONTROL_NOT_OWNED`.

Historical `session.status`, `session.observations`, and evidence reads must continue working after completion.

## Manual acceptance result

The final headed acceptance captured real human tab transitions across both `page_01` and `page_02`.

All `page_switched` observations were attributed to actor `human`.

The sensitive-data persistence check returned zero matches.

Real MCP mutation blocking and historical MCP readback also passed.

## Configuration

Milestone 9 adds no new public configuration.

Manual testing uses existing configuration including:

- `ROVE_HOME`
- `ROVE_BROWSER_HEADLESS`
- `ROVE_BROWSER`
- `ROVE_RUNTIME_TOKEN`
