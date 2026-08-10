import { redact } from "../auth/redact.js";

export interface McpLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export const stderrLogger: McpLogger = {
  debug: (message, context) => write("debug", message, context),
  info: (message, context) => write("info", message, context),
  warn: (message, context) => write("warn", message, context),
  error: (message, context) => write("error", message, context),
};

function write(level: string, message: string, context?: Record<string, unknown>): void {
  process.stderr.write(`${JSON.stringify({ level, message, ...(context === undefined ? {} : { context: redact(context) }) })}\n`);
}
