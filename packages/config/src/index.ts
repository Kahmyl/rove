import { resolve } from "node:path";
import { z } from "zod";

const booleanFromEnv = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

export const roveConfigSchema = z.object({
  home: z.string().min(1),
  runtime: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65_535),
    token: z.string().min(24).optional(),
  }),
  mcp: z.discriminatedUnion("transport", [
    z.object({ transport: z.literal("stdio") }),
    z.object({
      transport: z.literal("streamable-http"),
      host: z.string().min(1),
      port: z.number().int().min(1).max(65_535),
      path: z.string().startsWith("/"),
      bearerToken: z.string().min(24),
      allowedHosts: z.array(z.string()).optional(),
    }),
  ]),
  browser: z.object({
    headless: z.boolean(),
    preferredBrowser: z.enum(["chrome", "chromium"]),
  }),
  timeouts: z.object({
    navigationMs: z.number().int().positive(),
    actionMs: z.number().int().positive(),
    inspectMs: z.number().int().positive(),
    controlWaitMs: z.number().int().positive(),
  }),
});

export type RoveConfig = z.infer<typeof roveConfigSchema>;

export interface LoadConfigOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  overrides?: Partial<RoveConfig>;
}

export function loadConfig(options: LoadConfigOptions = {}): RoveConfig {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const transport = env.ROVE_MCP_TRANSPORT === "http" ? "streamable-http" : "stdio";
  const envHeadless = booleanFromEnv.parse(env.ROVE_BROWSER_HEADLESS);

  const defaults: RoveConfig = {
    home: resolve(cwd, env.ROVE_HOME ?? ".rove"),
    runtime: {
      host: env.ROVE_RUNTIME_HOST ?? "127.0.0.1",
      port: Number(env.ROVE_RUNTIME_PORT ?? 47_820),
      ...(env.ROVE_RUNTIME_TOKEN ? { token: env.ROVE_RUNTIME_TOKEN } : {}),
    },
    mcp:
      transport === "stdio"
        ? { transport }
        : {
            transport,
            host: env.ROVE_MCP_HOST ?? "127.0.0.1",
            port: Number(env.ROVE_MCP_PORT ?? 47_821),
            path: env.ROVE_MCP_PATH ?? "/mcp",
            bearerToken: env.ROVE_MCP_TOKEN ?? "",
          },
    browser: {
      headless: envHeadless ?? false,
      preferredBrowser: env.ROVE_BROWSER === "chromium" ? "chromium" : "chrome",
    },
    timeouts: {
      navigationMs: 30_000,
      actionMs: 10_000,
      inspectMs: 5_000,
      controlWaitMs: 30_000,
    },
  };

  return roveConfigSchema.parse({ ...defaults, ...options.overrides });
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
