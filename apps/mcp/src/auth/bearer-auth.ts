import { timingSafeEqual } from "node:crypto";
import { RoveError } from "@rove/protocol";

export class BearerTokenVerifier {
  private readonly expected: Buffer;

  constructor(token: string) {
    if (!token) throw new RoveError({ code: "INVALID_CONFIGURATION", message: "MCP token is required." });
    this.expected = Buffer.from(token);
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
