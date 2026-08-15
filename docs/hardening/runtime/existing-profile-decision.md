# Existing Chrome Profile Decision

## Decision

Ordinary existing Chrome profiles are unsupported for F4 production use.

## Rationale

Existing user Chrome profiles can contain credentials, cookies, extension state, browser-managed locks, and local settings owned by Chrome and the user. Rove must not copy, mutate, unlock, or launch writable automation against those profiles behind the user's back.

The supported persistence path is a Rove-managed persistent profile under Rove-owned storage, with metadata and locking controlled by Rove.

## Allowed Future Direction

A future workflow may support a dedicated browser profile that the user explicitly creates or selects for Rove. That would need separate consent, diagnostics, lock handling, and documentation.

## Current Implementation

`profile.mode: "existing"` remains implemented as a fast failure. The F4 runtime contract and ADR record this as an intentional safety boundary, not missing plumbing.
