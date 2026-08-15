# Container Browser Runtime Policy

## Current Status

Container browser runtime support is `SUPPORTED WITH LIMITATIONS` by contract, but this session did not validate Docker or Linux container behavior.

## Policy

Container runtimes should use bundled Playwright Chromium in headless mode unless a display server is explicitly configured. Profiles, downloads, and temporary runtime data must use writable Rove-controlled filesystem locations.

Desktop sandbox defaults must not be weakened to make container launches work. If a container lacks the OS capabilities required by Chromium sandboxing, the runtime must report that limitation explicitly instead of silently changing desktop policy.

## Required Validation

Before claiming container support for a release, run:

- `browser:doctor` inside the target container image;
- `browser:compat` inside the target container image;
- persistent profile restart verification on a mounted writable path;
- managed download verification on a mounted writable path;
- sandbox diagnostics for the container's kernel and security profile.

## Current Limitation

The current F4 Windows validation leaves Docker + Chromium + headless marked `UNVERIFIED`.
