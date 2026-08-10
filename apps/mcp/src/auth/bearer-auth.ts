import { timingSafeEqual } from "node:crypto";
import { RoveError } from "@rove/protocol";
import { validateBearerToken } from "./bearer-token.js";

export class BearerTokenVerifier {
  private readonly expected: Buffer;

  constructor(token: string) {
    this.expected = Buffer.from(validateBearerToken(token));
  }

  authenticate(authorization: string | null | undefined): void {
    if (!authorization) {
      throw new RoveError({ code: "MCP_AUTH_REQUIRED", message: "Bearer authentication is required." });
    }
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (!match?.[1]) {
      throw new RoveError({ code: "MCP_AUTH_INVALID", message: "Bearer authentication is invalid." });
    }
    const supplied = Buffer.from(match[1]);
    if (supplied.length !== this.expected.length || !timingSafeEqual(supplied, this.expected)) {
      throw new RoveError({ code: "MCP_AUTH_INVALID", message: "Bearer authentication is invalid." });
    }
  }
}

export function unauthorizedBody(): { error: { code: "UNAUTHORIZED"; message: string } } {
  return { error: { code: "UNAUTHORIZED", message: "Unauthorized." } };
}
