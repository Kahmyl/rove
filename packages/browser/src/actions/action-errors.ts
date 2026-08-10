import { RoveError } from "@rove/protocol";
import { errors as playwrightErrors } from "playwright";

export function actionError(error: unknown, action: string): RoveError {
  if (error instanceof RoveError) return error;
  if (error instanceof playwrightErrors.TimeoutError) {
    return new RoveError({ code: "ACTION_TIMEOUT", message: `${action} timed out.`, retryable: true });
  }
  if (error instanceof Error && /has been closed|is closed|browser.*disconnected/i.test(error.message)) {
    return new RoveError({ code: "BROWSER_CLOSED", message: "The browser session is closed." });
  }
  return new RoveError({ code: "TARGET_NOT_INTERACTIVE", message: `${action} could not be completed.` });
}
