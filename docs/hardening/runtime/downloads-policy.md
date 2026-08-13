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

Completed browser downloads are exposed to the runtime as `file` evidence. The evidence metadata includes the sanitized filename, original managed path, directory, size, suggested filename, and `source: "browser_download"` so MCP and desktop clients can report where Rove saved the download.

## Current Compatibility Coverage

`browser:compat` verifies:

- a normal download;
- duplicate filename handling;
- managed directory containment.
- cancelled download behavior;
- large bounded download behavior;
- browser-close-during-download behavior.

The real browser engine test suite verifies that persistent browser-session downloads are saved with sanitized, duplicate-preserving filenames inside the managed profile download directory.

## Remaining F4 Work

This is not the full final download implementation yet. Remaining work includes:

- defining session/profile association for saved downloads;
- interrupted download handling;
- cleanup policy for temporary downloads.
