# Browser Downloads Policy

## Current Policy

Rove browser-runtime downloads must be saved into a bounded Rove-managed directory. Callers must not provide arbitrary filesystem paths for browser downloads.

The current F4 implementation provides a managed-download utility that:

- creates scoped download directories under a caller-provided Rove-controlled root;
- rejects unsafe scope names;
- sanitizes suggested filenames;
- preserves duplicate filenames using suffixes such as `file (1).txt`;
- verifies saved paths remain inside the managed directory.

Production browser sessions now enable download acceptance at context startup and save page download events through the managed-download utility. Temporary sessions receive a private temporary download root that is removed on session close. Persistent sessions store managed downloads under the resolved Rove profile directory.

## Current Compatibility Coverage

`browser:compat` verifies:

- a normal download;
- duplicate filename handling;
- managed directory containment.

The real browser engine test suite verifies that persistent browser-session downloads are saved with sanitized, duplicate-preserving filenames inside the managed profile download directory.

## Remaining F4 Work

This is not the full final download implementation yet. Remaining work includes:

- defining session/profile association for saved downloads;
- cancelled download handling;
- interrupted download handling;
- browser-close-during-download behavior;
- large bounded test download behavior;
- cleanup policy for temporary downloads.
