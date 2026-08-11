# M12 Desktop Manual Acceptance

This runbook exercises the installed-style path from an external Codex agent,
through Rove's managed MCP and Runtime processes, into the local browser and
Companion handoff, and finally through clean session and application shutdown.

## 1. Start Rove Desktop

Open the unpacked application produced by `pnpm package:desktop:dir`:

```text
release/artifacts/mac-arm64/Rove.app
```

Wait until Companion displays `Ready` and `Waiting for a session`.

## 2. Copy the agent connection

From the macOS Rove application menu or the Rove tray menu, choose:

```text
Copy Agent Connection
```

The clipboard contains JSON with a loopback URL and bearer token:

```json
{
  "url": "http://127.0.0.1:<port>/mcp",
  "bearerToken": "<token>"
}
```

The token is generated for this Rove launch. Do not paste it into logs, issues,
or committed files. Restarting Rove invalidates these connection details.

## 3. Register Rove with Codex

Open a new terminal. Substitute the two copied values:

```bash
export ROVE_MCP_TOKEN='<bearerToken>'
codex mcp add rove \
  --url 'http://127.0.0.1:<port>/mcp' \
  --bearer-token-env-var ROVE_MCP_TOKEN
codex mcp get rove --json
```

If Codex reports that `rove` already exists, inspect it before replacing it:

```bash
codex mcp get rove --json
codex mcp remove rove
```

Then run the `codex mcp add` command again.

Registration is a hard prerequisite for the manual acceptance prompt. The
Codex agent should see Rove MCP tools such as `session.start`,
`browser.navigate`, `browser.inspect`, `control.request_human`, and
`control.wait` as mounted tool calls. A healthy loopback MCP HTTP endpoint is
not enough by itself; do not ask the agent to discover the endpoint from `.env`
or call it with ad hoc shell scripts.

## 4. Start a fresh agent

Keep the same terminal open so the exported token remains available:

```bash
mkdir -p /tmp/rove-manual-agent
cd /tmp/rove-manual-agent
codex
```

Paste this prompt into the new Codex session:

```text
Use only mounted Rove MCP tool calls for browser work. Do not use shell
commands, Node scripts, direct HTTP requests, Playwright, Chrome control,
in-app browser tools, or any other browser integration.

Before starting, confirm that Rove MCP tools are available in this session. If
they are not mounted, stop and report: "Rove MCP is not connected in this Codex
session." Do not inspect the repository, read `.env`, probe localhost ports, or
construct an MCP client manually.

1. Start a Companion Mode session at https://example.com.
2. Inspect the page and take a viewport screenshot.
3. Request human control with the reason: "Manual acceptance: scroll the page,
   then return control to the agent."
4. Wait for the human handoff to complete. Do not end the session while waiting.
5. After control returns, inspect the page again, read the session observations,
   save a short evidence record saying the manual handoff succeeded, and list
   the evidence.
6. End the Rove session and summarize each completed step.
```

## 5. Complete the human handoff

Rove should surface Companion automatically.

1. Confirm Companion says `Your turn` and shows the acceptance reason.
2. Click `Start this step`.
3. In the Rove-managed browser, scroll the page.
4. Return to Companion.
5. Click `Done — Resume Automation`.
6. Watch the Codex session resume, inspect again, save evidence, and end the
   session.

## 6. Verify completion

Confirm all of the following:

- Rove launched the local browser without a separate Runtime or MCP command.
- Companion changed from agent work to requested handoff and human control.
- Browser mutations paused while the human owned control.
- Codex resumed only after control was returned.
- Codex read observations and evidence through MCP.
- Ending the session closed the managed browser.
- Companion returned to its no-session state.
- Quitting Rove from the tray closed Desktop, Runtime, and MCP.

## 7. Remove the temporary Codex connection

The connection is launch-specific, so remove it after the test:

```bash
codex mcp remove rove
unset ROVE_MCP_TOKEN
```
