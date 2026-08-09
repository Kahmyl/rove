import { RoveError } from "@rove/protocol";

export async function connectStreamableHttp(): Promise<never> {
  throw new RoveError({
    code: "NOT_IMPLEMENTED",
    message: "Streamable HTTP transport is scaffolded for the Phase 4 implementation slice.",
  });
}
