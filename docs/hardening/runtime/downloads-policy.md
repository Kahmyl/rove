# Browser Downloads Policy

## Current Policy

Rove browser-runtime downloads must be saved into a bounded Rove-managed directory. Callers must not provide arbitrary filesystem paths for browser downloads.

The current F4 implementation provides a managed-download utility that:

- creates scoped download directories under a caller-provided Rove-controlled root;
- rejects unsafe scope names;
- sanitizes suggested filenames;
- preserves duplicate filenames using suffixes such as `file (1).txt`;
- verifies saved paths remain inside the managed directory.

## Current Compatibility Coverage

`browser:compat` verifies:

- a normal download;
- duplicate filename handling;
- managed directory containment.

## Remaining F4 Work

This is not the full final download implementation yet. Remaining work includes:

- wiring managed downloads into production browser sessions;
- defining session/profile association for saved downloads;
- cancelled download handling;
- interrupted download handling;
- browser-close-during-download behavior;
- large bounded test download behavior;
- cleanup policy for temporary downloads.

