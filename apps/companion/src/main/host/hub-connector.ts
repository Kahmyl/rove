import {
  ROVE_HUB_PROTOCOL_VERSION,
  hubCommandSchema,
  type HubCommandResult,
} from "@rove/protocol";

import {
  executeHubCommand,
  toHubCommandError,
  type LocalRuntimeConnection,
} from "./hub-command-executor.js";

export interface HubConnectorOptions {
  controlPlaneUrl: string;
  deviceId: string;
  token: string;
  runtime: LocalRuntimeConnection;
  retryDelayMs?: number;
}

export class HubConnector {
  private controller: AbortController | undefined;
  private loop: Promise<void> | undefined;

  constructor(private readonly options: HubConnectorOptions) {}

  start(): void {
    if (this.loop !== undefined) throw new Error("Hub connector is already running.");
    const controller = new AbortController();
    this.controller = controller;
    this.loop = this.run(controller.signal).finally(() => {
      if (this.controller === controller) this.controller = undefined;
      this.loop = undefined;
    });
  }

  async stop(): Promise<void> {
    this.controller?.abort();
    await this.loop?.catch(() => undefined);
  }

  private async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const command = await this.poll(signal);
        if (command === undefined) continue;
        let result: HubCommandResult;
        try {
          const value = await executeHubCommand(command, this.options.runtime);
          result = {
            protocolVersion: ROVE_HUB_PROTOCOL_VERSION,
            commandId: command.commandId,
            deviceId: command.deviceId,
            ok: true,
            result: value,
          };
        } catch (error) {
          result = {
            protocolVersion: ROVE_HUB_PROTOCOL_VERSION,
            commandId: command.commandId,
            deviceId: command.deviceId,
            ok: false,
            error: toHubCommandError(error),
          };
        }
        await this.sendResultWithRetry(result, signal);
      } catch (error) {
        if (signal.aborted) return;
        console.warn("[hub] Control-plane connection failed; retrying.", error);
        await delay(this.options.retryDelayMs ?? 1_000, signal);
      }
    }
  }

  private async poll(signal: AbortSignal) {
    const response = await fetch(
      new URL(`/v1/devices/${encodeURIComponent(this.options.deviceId)}/poll`, this.options.controlPlaneUrl),
      {
        method: "POST",
        headers: { authorization: `Bearer ${this.options.token}` },
        signal,
      },
    );
    if (response.status === 204) return undefined;
    if (!response.ok) throw new Error(`Control-plane poll failed with HTTP ${response.status}.`);
    const command = hubCommandSchema.parse(await response.json());
    if (command.deviceId !== this.options.deviceId) throw new Error("Control plane returned a command for another device.");
    return command;
  }

  private async sendResult(result: HubCommandResult, signal: AbortSignal): Promise<void> {
    const response = await fetch(
      new URL(`/v1/commands/${encodeURIComponent(result.commandId)}/result`, this.options.controlPlaneUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(result),
        signal,
      },
    );
    if (!response.ok) throw new Error(`Control-plane result delivery failed with HTTP ${response.status}.`);
  }

  private async sendResultWithRetry(
    result: HubCommandResult,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.sendResult(result, signal);
        return;
      } catch (error) {
        if (signal.aborted) return;
        console.warn("[hub] Result delivery failed; retrying.", error);
        await delay(this.options.retryDelayMs ?? 1_000, signal);
      }
    }
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
