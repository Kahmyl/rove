import { z } from "zod";

export const ROVE_HUB_PROTOCOL_VERSION = 1 as const;

export const hubOperationSchema = z.enum([
  "runtime.health",
  "session.start",
  "session.status",
  "session.end",
  "session.observations",
  "browser.navigate",
  "browser.open_page",
  "browser.pages",
  "browser.switch_page",
  "browser.close_page",
  "browser.inspect",
  "browser.resolve_target",
  "browser.interact",
  "browser.transaction_begin",
  "browser.transaction_advance",
  "browser.transaction_verify",
  "browser.transaction_status",
  "browser.transaction_cancel",
  "browser.click",
  "browser.type",
  "browser.press",
  "browser.scroll",
  "browser.back",
  "browser.forward",
  "browser.screenshot",
  "evidence.create_file",
  "evidence.request_file_grant",
  "evidence.save_record",
  "evidence.list",
  "evidence.read",
  "control.status",
  "control.request_human",
  "control.wait",
]);

export type HubOperation = z.infer<typeof hubOperationSchema>;

export const hubCommandSchema = z.object({
  protocolVersion: z.literal(ROVE_HUB_PROTOCOL_VERSION),
  commandId: z.string().min(1).max(200),
  deviceId: z.string().min(1).max(200),
  operation: hubOperationSchema,
  payload: z.unknown(),
});

export type HubCommand = z.infer<typeof hubCommandSchema>;

export const hubCommandErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().default(false),
  details: z.unknown().optional(),
});

export type HubCommandError = z.infer<typeof hubCommandErrorSchema>;

export const hubCommandResultSchema = z.discriminatedUnion("ok", [
  z.object({
    protocolVersion: z.literal(ROVE_HUB_PROTOCOL_VERSION),
    commandId: z.string().min(1).max(200),
    deviceId: z.string().min(1).max(200),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    protocolVersion: z.literal(ROVE_HUB_PROTOCOL_VERSION),
    commandId: z.string().min(1).max(200),
    deviceId: z.string().min(1).max(200),
    ok: z.literal(false),
    error: hubCommandErrorSchema,
  }),
]);

export type HubCommandResult = z.infer<typeof hubCommandResultSchema>;

export const submitHubCommandSchema = z.object({
  operation: hubOperationSchema,
  payload: z.unknown(),
  timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
});

export type SubmitHubCommand = z.infer<typeof submitHubCommandSchema>;
