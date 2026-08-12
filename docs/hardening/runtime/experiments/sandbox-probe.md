# Sandbox Probe Experiment

## Experiment

Add a conservative Chromium sandbox probe to `browser:doctor`.

## Hypothesis

`chrome://sandbox` can provide useful sandbox status signals in some Chromium environments, but it may be unavailable or ambiguous depending on browser mode, platform, and launch constraints.

## Matrix

Initial implementation target:

- Windows x64;
- Playwright Chromium;
- headless;
- temporary profile.

Future matrix:

- macOS + Chrome + headed;
- macOS + Chromium + headed/headless;
- Linux + Chromium + headed/headless;
- Docker + Chromium + headless;
- Windows + Chrome + headed.

## Results

The probe attempts to open:

```text
chrome://sandbox
```

and parses only recognized positive or negative sandbox status signals.

If the page cannot be inspected, or its text does not contain a known signal, the result is:

```text
unknown
```

This is intentional. F4 should not claim sandbox status from launch configuration alone.

## Decision

Add the probe as diagnostic evidence, not as policy enforcement.

`browser:doctor` now reports:

- planned sandbox policy from the launch plan;
- verified sandbox status from the probe;
- the method and details of the probe result.

## Rejected Alternative

Treating launch arguments as proof of sandbox state was rejected.

## Reason

The F4 contract requires distinguishing requested configuration, resolved configuration, and verified runtime behavior. Sandbox status is verified only when Chromium exposes a clear signal.

