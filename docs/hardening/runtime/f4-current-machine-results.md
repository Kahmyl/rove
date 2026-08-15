# F4 Current-Machine Results

## Environment

- OS: Windows x64
- Node: v24.13.0
- Playwright: 1.62.1
- Browser: Playwright Chromium 151.0.7922.34
- Mode: headless

## Compatibility Result

`browser:compat` passes on the current machine with these limitations:

- WebSocket live-message exchange is not covered by the raw local fixture; WebSocket API availability is reported as `PASS_WITH_LIMITATION`.
- Page crash uses `chrome://crash` and may report `UNVERIFIED` on runtimes where that crash fixture is not reproducible.
- Native persistent profile locking remains `PASS_WITH_LIMITATION`; Rove-level profile locking is required and implemented separately.
- Rove-runtime compatibility cases exercise `PlaywrightBrowserEngine`, `BrowserSession`, managed download activity, persistent profile manager, profile lock rejection, and runtime capability reporting.

## Covered Areas

- launch and navigation;
- temporary storage isolation;
- service-worker registration;
- Cache Storage;
- popups;
- dialogs;
- managed downloads;
- file chooser;
- default permission behavior;
- same-origin and cross-origin iframes;
- WebSocket API availability;
- SPA history;
- long timer;
- large page;
- browser disconnect;
- persistent profile restart;
- native persistent profile lock observation.
- Rove runtime temporary session launch/inspect;
- Rove runtime managed download activity;
- Rove runtime persistent profile manager/lock/capability path.
