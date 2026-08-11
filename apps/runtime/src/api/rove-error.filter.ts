import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import { RoveError } from "@rove/protocol";

const STATUS_BY_CODE: Partial<Record<RoveError["code"], number>> = {
  SESSION_NOT_FOUND: 404,
  PAGE_NOT_FOUND: 404,
  EVIDENCE_NOT_FOUND: 404,
  CONTROL_NOT_OWNED: 409,
  INSPECTION_REQUIRED: 409,
  PAGE_NOT_READY: 409,
  ACTION_RATE_LIMITED: 429,
  REPEATED_ACTION_BLOCKED: 429,
  ACTION_BUDGET_EXCEEDED: 429,
  AUTHENTICATION_REQUIRED: 423,
  HUMAN_VERIFICATION_REQUIRED: 423,
  SITE_ACCESS_RESTRICTED: 423,
  UNKNOWN_INTERSTITIAL: 423,
  TARGET_STALE: 409,
  PAGE_CHANGED: 409,
  SESSION_ALREADY_ENDED: 409,
  TARGET_DISABLED: 422,
  TARGET_NOT_VISIBLE: 422,
  TARGET_NOT_INTERACTIVE: 422,
  INVALID_CONFIGURATION: 400,
  BROWSER_CLOSED: 410,
  ACTION_TIMEOUT: 504,
  BROWSER_LAUNCH_FAILED: 500,
  NAVIGATION_FAILED: 500,
  EVIDENCE_WRITE_FAILED: 500,
};

@Catch()
export class RoveErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{ status(code: number): { json(body: unknown): void } }>();
    if (exception instanceof RoveError) {
      response.status(STATUS_BY_CODE[exception.code] ?? 400).json(exception.toJSON());
      return;
    }
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json({ ok: false, error: { code: "INVALID_CONFIGURATION", message: exception.getStatus() === 401 ? "Unauthorized." : "Request failed.", retryable: false } });
      return;
    }
    if (exception instanceof Error && exception.name === "ZodError") {
      response.status(400).json({ ok: false, error: { code: "INVALID_CONFIGURATION", message: "Request validation failed.", retryable: false } });
      return;
    }
    response.status(500).json({ ok: false, error: { code: "INVALID_CONFIGURATION", message: "Unexpected runtime failure.", retryable: false } });
  }
}
