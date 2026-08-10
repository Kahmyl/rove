import { RoveError } from "@rove/protocol";

export function validateBearerToken(token: string): string {
  if (token.length < 24) {
    throw new RoveError({ code: "INVALID_CONFIGURATION", message: "MCP bearer token must be at least 24 characters." });
  }
  return token;
}
