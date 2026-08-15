# ADR: Browser Runtime V2

## Status

Accepted for F4 implementation.

## Context

F4 defines Rove's browser runtime fidelity and compatibility contract. The runtime must launch Chromium-family browsers deliberately, isolate temporary sessions, preserve Rove-managed persistent profiles, avoid silent permission elevation, keep downloads inside managed directories, and expose compatibility facts through deterministic diagnostics.

The protocol includes an `existing` profile mode, but ordinary Chrome user profiles carry browser-owned locks, credential stores, extension state, and user data that Rove must not copy, mutate, or bypass.

## Decision

Rove Browser Runtime V2 supports:

- temporary Chromium-family sessions;
- Rove-managed persistent profiles;
- deliberate Chrome or bundled Chromium selection;
- headed desktop sessions and headless automation sessions as separate runtime classes;
- Rove-level persistent profile locking;
- managed downloads;
- default browser permission behavior;
- service workers, cookies, localStorage, sessionStorage, IndexedDB, and Cache Storage according to the runtime contract;
- browser-runtime frame fidelity, including iframe enumeration, iframe-visible text, iframe target plumbing, and frame-aware target resolution;
- structured browser runtime capability reporting;
- sandbox diagnostics that distinguish requested policy from verified runtime status;
- deterministic compatibility reporting.

Ordinary existing Chrome profiles remain unsupported for production use. Rove will not attach to, copy, mutate, or bypass locks for a user's normal Chrome profile. A future explicit-import or dedicated-profile workflow can be designed separately if product requirements justify it.

F4 owns frame plumbing only where it is necessary to make browser runtime compatibility observable and actionable. F1 remains responsible for semantic inspection quality, target ranking, labeling heuristics, perception evidence fusion, and page-state interpretation. In short: F4 provides frame capability and execution plumbing; F1 decides what frames mean.

The production browser decision is:

- Desktop interactive: prefer system Google Chrome when requested/configured, fall back to bundled Playwright Chromium only when Chrome is unavailable, and report fallback explicitly.
- Local/CI automation: bundled Playwright Chromium is acceptable and expected.
- Docker/container automation: Chromium headless is supported with limitations until container sandbox status is verified in that environment.
- Headless and headed runs are not treated as equivalent; compatibility reports must record the mode.
- Requested sandbox policy records what Rove asked Chromium to do at launch. By default Rove requests normal sandboxing by removing Playwright's sandbox-disabling defaults; caller-supplied sandbox-disabling launch args are reported as requested sandbox disabled. If a verified runtime cannot create usable pages with that request, Rove may fall back only with an explicit diagnostic and must report the actual launched sandbox policy.
- Verified sandbox state is never inferred from launch args alone. It is `unknown` unless the runtime probe observes a recognized enabled or disabled signal.
- Downloads are always managed by Rove and surfaced as runtime activity; Runtime persists completed downloads as `file` evidence.
- Permissions use browser defaults unless a future explicit grant policy is introduced. Sensitive permissions must not be silently granted by F4.
- Browser versions are reported, not hard-pinned. Newer compatible Chromium-family versions are allowed but must appear in diagnostics and acceptance reports.
- Safe diagnostics may include browser family, distribution, version, headless/headed mode, profile mode/name, sandbox status, managed-download support, and storage capability status. Diagnostics must not include secrets, cookies, clipboard contents, or downloaded file contents.
- Operating-system and browser matrix entries are `VERIFIED` only after an actual run in that environment. Missing environments remain `UNVERIFIED`, not PASS or FAIL.

## Consequences

- `profile.mode: "existing"` continues to fail fast with a structured unsupported-path error.
- Users who need persistence should use Rove-managed persistent profiles.
- Compatibility reports can distinguish supported behavior from runtime limitations.
- Session status can expose an immutable runtime capability snapshot for the running browser session.
- Cross-frame inspection changes remain in F4 as browser-runtime fidelity work, with the ownership boundary recorded here.
- Future work can add origin-scoped permission grants and richer crash recovery without changing this ownership boundary.
