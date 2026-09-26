# ROVE-STAB-04 — Runtime failure containment and observability

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Ready  
**Dependencies:** STAB-01  
**Baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Invariant

Runtime dependency failure is classified, bounded and contained. Permanent configuration failures are not polled as transient outages; transient failures use bounded retry/backoff; no Runtime polling path can create an unhandled-rejection storm.

## Owns

MR-004 and MR-005.

## Diagnosis requirements

Identify the exact field/condition that produced `INVALID_CONFIGURATION` from retained Runtime-side evidence. Do not infer it from the client status code.

Audit all `CompanionRuntimeClient` call sites, including snapshot refresh, workspace refresh, surface monitoring, workflow-triggered refresh, IPC handlers and startup sequencing.

## Acceptance criteria

- Permanent 4xx/configuration error enters a stable degraded state and stops aggressive polling.
- Retryable transport failure uses bounded backoff and recovery.
- First actionable diagnostic is retained safely.
- Repeated failures do not produce process-level unhandled rejections.
- A healthy Runtime transition reopens polling/refresh cleanly.
- Customer UI receives one bounded state rather than a stream of low-level errors.

## Verification

Runtime-client fault injection → desktop snapshot/surface monitor tests → process-backed managed Runtime invalid-config/unavailable runs → rejection-count assertion.

Checkpoint independently of STAB-03.
