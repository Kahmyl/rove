# Rove V1 Manual Testing

This guide verifies the complete Rove V1 product workflow.

A tester should be able to complete every scenario below without implementation knowledge or additional setup instructions.

## Prerequisites

Install dependencies and build the repository:

```bash
pnpm install
pnpm build
```

The headed manual scenarios require Chromium or Chrome to be available through Playwright.

---

## Scenario A — Agent Task over MCP stdio

Run:

```bash
pnpm test:e2e
```

The first E2E case starts the real runtime, launches Chromium, starts the real MCP stdio process, and performs a complete agent task:

1. Start an Agent session.
2. Inspect the page.
3. Enter a search.
4. Submit the search.
5. Open a result.
6. Save structured evidence.
7. Capture screenshot evidence.
8. Read observations.
9. Complete the session.

Expected output includes:

```text
runs a complete agent task through real MCP stdio
```

The test must pass.

---

## Scenario B — Agent Task over Authenticated Streamable HTTP

Scenario B runs as the second case of:

```bash
pnpm test:e2e
```

It performs the same browser task through:

- Streamable HTTP MCP
- bearer authentication
- the real runtime
- a real Chromium browser

Expected output includes:

```text
runs the same task through authenticated Streamable HTTP
```

The test must pass.

The E2E harness removes inherited `ROVE_*` variables before spawning child processes so unrelated local shell configuration cannot change the acceptance environment.

---

## Shared Setup for Scenarios C and D

Open three terminals.

### Terminal 1 — Runtime

```bash
cd /Users/habibkamil/Documents/monorepo/rove

rm -rf .rove-m10-manual

ROVE_HOME=/Users/habibkamil/Documents/monorepo/rove/.rove-m10-manual \
ROVE_RUNTIME_HOST=127.0.0.1 \
ROVE_RUNTIME_PORT=47920 \
ROVE_RUNTIME_TOKEN=m10-runtime-manual-token-1234567890 \
ROVE_BROWSER_HEADLESS=false \
ROVE_BROWSER=chromium \
pnpm dev:runtime
```

Leave the runtime running.

Wait until the terminal shows:

```text
Nest application successfully started
```

### Terminal 2 — Electron Companion

```bash
cd /Users/habibkamil/Documents/monorepo/rove

ROVE_RUNTIME_URL=http://127.0.0.1:47920 \
ROVE_RUNTIME_TOKEN=m10-runtime-manual-token-1234567890 \
pnpm dev:companion
```

Leave the Companion open.

It may initially show that no session is active.

---

## Scenario C — Human Handoff

In Terminal 3 run:

```bash
cd /Users/habibkamil/Documents/monorepo/rove

ROVE_RUNTIME_URL=http://127.0.0.1:47920 \
ROVE_RUNTIME_TOKEN=m10-runtime-manual-token-1234567890 \
pnpm --filter @rove/mcp test:manual:handoff
```

The harness starts a Companion Mode session and requests human assistance.

When the terminal reports that Scenario C is ready:

1. Confirm the Companion displays the handoff reason.
2. Confirm the session is awaiting the human.
3. Click `Take Control`.
4. Switch to the browser.
5. Click `Human Action`.
6. Confirm the page says `Human interaction complete`.
7. Return to the Companion.
8. Click `Return Control`.
9. Wait for the harness to finish.

The harness then verifies automatically that:

- human takeover was observed;
- control returned to the agent;
- a target captured before handoff became stale;
- a fresh inspection works;
- the agent can continue;
- the session completes.

Expected final result:

```text
SCENARIO C: PASS
```

---

## Scenario D — Capture Mode

Keep Terminal 1 and Terminal 2 running.

In Terminal 3 run:

```bash
cd /Users/habibkamil/Documents/monorepo/rove

ROVE_HOME=/Users/habibkamil/Documents/monorepo/rove/.rove-m10-manual \
ROVE_RUNTIME_URL=http://127.0.0.1:47920 \
ROVE_RUNTIME_TOKEN=m10-runtime-manual-token-1234567890 \
pnpm --filter @rove/mcp test:manual:capture
```

Confirm in the Companion:

- Mode is `Capture`.
- Controller is the human.
- Take/Return controls are unavailable.
- Finish Session is available.

Perform these browser actions in order:

1. Click `Visit Details`.
2. Click `Meaningful Action`.
3. Change `Sort Order` from `Newest` to `Oldest`.
4. Scroll all the way to the bottom.
5. Click `Open Tab`.
6. Switch to the newly opened tab and wait about one second.
7. Switch back to the original tab and wait about one second.
8. Enter the exact password fixture value printed by the harness.
9. Click `Submit Form`.
10. Confirm `Capture submission complete` appears.
11. In the Companion click `Finish Session`.

The harness verifies automatically that:

- Capture Mode starts human-owned;
- agent browser mutation is blocked;
- navigation is captured;
- meaningful clicks are captured;
- selection changes are captured;
- scroll milestones are captured;
- tab opening is captured;
- real human tab switching is captured;
- form submission is captured;
- observations remain ordered;
- MCP can read the completed human journey;
- the password is absent from MCP observation readback;
- the password is absent from persisted Rove data.

Expected final result:

```text
SCENARIO D: PASS
```

---

## Shutdown Verification

When manual testing is complete, stop the runtime with `Ctrl+C`.

Runtime shutdown must close all attached browser sessions.

A failure while closing one browser must not prevent cleanup of the remaining browser sessions.

Pending control waits must also be rejected cleanly during runtime shutdown.

---

## HTTP Error Verification

Run:

```bash
pnpm vitest run apps/mcp/src/control-transports.integration.test.ts
```

The Streamable HTTP regression tests verify that malformed JSON produces a controlled:

```text
400 INVALID_JSON
```

The MCP HTTP process must remain usable afterward.

---

## Final V1 Gates

Before merge run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
git diff --check
```

Every command must succeed.

---

## V1 Acceptance

Rove V1 is accepted when:

- an external MCP agent can operate the browser through stdio;
- the same workflow works through authenticated Streamable HTTP;
- the Electron Companion supports exclusive human takeover and return;
- stale targets cannot survive human-to-agent handback;
- Capture Mode records the meaningful human browser journey;
- sensitive entered values are not persisted;
- runtime shutdown cleans up attached browsers;
- malformed HTTP requests do not destabilize the MCP process.

The final product definition is:

> An external MCP agent can operate a visible browser through Rove while structured browser state, evidence, exclusive human-agent control, and manual Capture Mode all work reliably.
