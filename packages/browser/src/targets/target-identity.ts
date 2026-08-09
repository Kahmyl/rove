export interface TargetIdentity {
  role?: string;
  name?: string;
  tag?: string;
  type?: string;
  text?: string;
  id?: string;
  testId?: string;
  attributes?: Record<string, string>;
  domPathHint?: string;
}

export function isSensitiveTarget(identity: TargetIdentity): boolean {
  const inputType = identity.type?.toLowerCase();
  const autocomplete = identity.attributes?.autocomplete?.toLowerCase();
  const semanticName = `${identity.name ?? ""} ${identity.id ?? ""}`.toLowerCase();
  return (
    inputType === "password" ||
    autocomplete === "current-password" ||
    autocomplete === "new-password" ||
    autocomplete === "one-time-code" ||
    /\b(password|passcode|otp|one.?time|secret|token)\b/.test(semanticName)
  );
}
