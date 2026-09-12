import {
  assertRendererProductIntent,
  type LocalProductApi,
  type LocalProductResult,
} from "./local-product-api.js";

export type RendererProductApiPort = Pick<
  LocalProductApi,
  "executeRendererIntent"
>;

/** Main-process IPC adapter. Untrusted values are rejected before product mutation. */
export function createProductIntentIpcHandler(
  api: () => RendererProductApiPort,
  publish: () => Promise<void>,
): (_event: unknown, intent: unknown) => Promise<LocalProductResult> {
  return async (_event, intent) => {
    assertRendererProductIntent(intent);
    const result = await api().executeRendererIntent(intent);
    await publish();
    return result;
  };
}
