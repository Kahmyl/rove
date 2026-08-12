# Browser Permissions Policy

## Current Policy

Rove browser sessions use default browser permission behavior. They do not silently grant geolocation, clipboard-read, notifications, camera, or microphone access at context startup.

Future permission grants must be explicit, origin-scoped, and reported through runtime diagnostics or task-facing state.

## Current Compatibility Coverage

`browser:compat` verifies:

- file chooser events can be observed without selecting a file;
- geolocation is not silently granted;
- notification permission is not silently granted;
- clipboard-read is not silently granted where the browser exposes it;
- camera and microphone permissions are not silently granted where the browser exposes them.

Unsupported permission probes are reported as `PASS_WITH_LIMITATION` rather than hidden.

## Remaining F4 Work

- Define origin-scoped permission grant APIs if product workflows require them.
- Add production diagnostics for effective permission state.
- Decide how user-facing surfaces should report permission prompts or blocked permissions.
