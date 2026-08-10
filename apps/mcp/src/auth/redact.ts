const SECRET_KEYS = new Set(["authorization", "token", "bearerToken", "runtimeToken", "value", "password", "otp"]);

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SECRET_KEYS.has(key) || key.toLowerCase().includes("token") ? "[REDACTED]" : redact(nested),
    ]),
  );
}
