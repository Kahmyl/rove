export interface ProviderIntegrationCase {
  id: string;
  tier: "B";
  provider: "cloudflare-turnstile" | "google-recaptcha" | "hcaptcha";
  purpose: string;
  requiredUrlEnvironmentVariable: string;
  enabledByDefault: false;
  tags: string[];
}

export const PROVIDER_INTEGRATION_CASES: ProviderIntegrationCase[] = [
  {
    id: "provider-turnstile-visible-test",
    tier: "B",
    provider: "cloudflare-turnstile",
    purpose:
      "Validate classification and handoff against an explicitly configured official Turnstile test integration.",
    requiredUrlEnvironmentVariable: "ROVE_F1_TURNSTILE_TEST_URL",
    enabledByDefault: false,
    tags: ["provider", "human-verification", "network", "opt-in"],
  },
  {
    id: "provider-recaptcha-visible-test",
    tier: "B",
    provider: "google-recaptcha",
    purpose:
      "Validate classification and handoff against an explicitly configured official reCAPTCHA test integration.",
    requiredUrlEnvironmentVariable: "ROVE_F1_RECAPTCHA_TEST_URL",
    enabledByDefault: false,
    tags: ["provider", "human-verification", "network", "opt-in"],
  },
  {
    id: "provider-hcaptcha-visible-test",
    tier: "B",
    provider: "hcaptcha",
    purpose:
      "Validate classification and handoff against an explicitly configured official hCaptcha test integration.",
    requiredUrlEnvironmentVariable: "ROVE_F1_HCAPTCHA_TEST_URL",
    enabledByDefault: false,
    tags: ["provider", "human-verification", "network", "opt-in"],
  },
];
