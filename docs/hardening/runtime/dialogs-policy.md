# Browser Dialogs Policy

## Current Policy

Production browser sessions install a page-level dialog listener for JavaScript `alert`, `confirm`, `prompt`, and `beforeunload` dialogs. The default action is to dismiss the dialog so browser actions do not hang indefinitely.

Rove records a `dialog_opened` browser activity event with the dialog type and default action. It does not record dialog text, prompt defaults, or prompt responses because those values may contain user-significant or secret-bearing content.

## Current Compatibility Coverage

`browser:compat` verifies alert, confirm, prompt, and beforeunload dialogs are observed and dismissed without deadlock.

The browser action test suite verifies production sessions dismiss alert, confirm, and prompt dialogs and emit sanitized dialog activity.

## Remaining F4 Work

- Decide whether user-visible product surfaces should expose blocked/dismissed dialog notifications.
- Define explicit future controls for accepting or responding to dialogs when a task genuinely requires it.
