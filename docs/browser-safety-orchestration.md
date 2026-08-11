# Browser safety orchestration

Rove is a user-authorized browser assistant. This layer keeps automation at a
human-scale, hands human-only steps back to the user, and stops ambiguous
workflows. It is a compliance boundary, not a promise that sites will never
restrict access and not an anti-detection or CAPTCHA-solving system.

## Runtime-owned contract

```text
Agent -> MCP contract -> Runtime policy -> paced browser action
                                      -> inspection -> page classifier
                                                    -> continue | wait | handoff | stop
```

The Runtime is authoritative. An alternative MCP client cannot bypass these
rules. MCP descriptions tell agents how to respond, while stable `RoveError`
codes make the response machine-readable.

Every Playwright inspection includes `metadata.pageState`:

- `ready`: mutations may continue within the action budget.
- `loading`: wait, then inspect again.
- `authentication_required`: request human control.
- `human_verification`: request human control; never solve automatically.
- `access_restricted`: stop mutations and request human review.
- `unknown_interstitial`: do not guess; request human review.
- `error`: stop the current mutation workflow.

The classifier uses explainable signals: URL/title, main-document HTTP status,
visible text, raw HTML, document readiness, frame URLs, and target/content
presence. It deliberately does not use OCR or infer a CAPTCHA from an empty
DOM. Empty visible content on a non-empty stable HTTP document becomes
`unknown_interstitial`.

After human control returns, all target references are invalidated and the
agent must call `browser.inspect` before any mutation. The Runtime also applies
headed-browser action pacing, a rolling action budget, and a deterministic
repeated-action limit. It does not add random cursor movement, fingerprint
spoofing, stealth plugins, CAPTCHA solving, or proxy rotation.

## Smoke campaign

Run locally before any live campaign:

```sh
pnpm vitest run packages/browser/src/safety apps/runtime/src/policy apps/runtime/src/runtime.integration.test.ts
```

The deterministic fixtures cover:

| Scenario | Expected result |
| --- | --- |
| Normal document | `ready` |
| Loading document | `loading`; mutation rejected as retryable |
| Login wall | `authentication_required`; human handoff |
| CAPTCHA/security frame | `human_verification`; human handoff |
| Explicit restriction or HTTP 403/429 | `access_restricted`; human handoff |
| Visual/empty-DOM interstitial | `unknown_interstitial`; human handoff |
| HTTP 5xx | `error`; mutation stopped |
| Repeated identical action | `REPEATED_ACTION_BLOCKED` |
| Rolling action excess | `ACTION_BUDGET_EXCEEDED` |
| Return from human control | `INSPECTION_REQUIRED` until reinspection |

## Live campaign protocol

Live validation is read-only and intentionally small. Test one representative
site per state, save inspection/screenshot evidence, and stop immediately when
the site requests verification or restricts access.

1. Start a headed persistent-profile session.
2. Inspect before the first mutation and record `metadata.pageState`.
3. Exercise a short normal navigation on a low-risk public documentation site.
4. Exercise authentication only up to the login wall, then verify handoff.
5. Use an official CAPTCHA/Turnstile demo only to verify classification and
   handoff; do not solve it automatically.
6. Verify an internally controlled visual interstitial and slow SPA fixture.
7. Record expected state, actual state, signals, action result, and evidence ID.
8. End the session. A failed or ambiguous classification blocks release.

Do not use a site that is currently restricting the device or network as a
smoke target. A later retry is a separate, user-authorized live campaign—not an
automatic retry loop.

## Release gate

The slice is ready when classifier and policy unit tests pass, Runtime handoff
integration tests pass, MCP exposes the structured contract, full typecheck and
lint pass, and a read-only live campaign produces evidence for each live state
attempted. Site-specific access is never a release guarantee.
