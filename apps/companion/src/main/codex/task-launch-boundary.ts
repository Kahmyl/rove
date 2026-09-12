import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { NativeBrowserIdentity } from "@rove/protocol";

export interface TaskCapabilityClaims {
  taskId: string;
  sessionId: string;
  executionMode: "agent" | "companion" | "capture";
  browserIdentity: NativeBrowserIdentity;
  nonce: string;
}

/** Deterministic task capability issuer. Persisting the key plus the exact
 * task/session/mode/browser binding makes issuance reproducible after restart. */
export class PersistedTaskCapabilityIssuer {
  constructor(private readonly key: Buffer = randomBytes(32)) {
    if (key.byteLength !== 32)
      throw new Error("Task capability key must be 32 bytes.");
  }

  issue(claims: Omit<TaskCapabilityClaims, "nonce">): {
    token: string;
    fingerprint: string;
  } {
    const nonce = createHmac("sha256", this.key)
      .update(`${claims.taskId}:${claims.sessionId}`)
      .digest("hex")
      .slice(0, 32);
    const payload = Buffer.from(JSON.stringify({ ...claims, nonce })).toString(
      "base64url",
    );
    const signature = createHmac("sha256", this.key)
      .update(payload)
      .digest("base64url");
    const token = `rtcap_${payload}.${signature}`;
    return {
      token,
      fingerprint: createHash("sha256").update(token).digest("hex"),
    };
  }

  verify(token: string): TaskCapabilityClaims {
    const match = /^rtcap_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
    if (!match?.[1] || !match[2]) throw new Error("Invalid task capability.");
    const expected = createHmac("sha256", this.key).update(match[1]).digest();
    const actual = Buffer.from(match[2], "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new Error("Invalid task capability signature.");
    return JSON.parse(
      Buffer.from(match[1], "base64url").toString("utf8"),
    ) as TaskCapabilityClaims;
  }

  verifier(): string {
    return this.key.toString("base64url");
  }
}

