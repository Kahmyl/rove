import { z } from "zod";

export const componentKindSchema = z.enum([
  "companion",
  "mcp",
  "control_plane",
  "runtime",
]);

export const componentInstanceIdentitySchema = z.object({
  component: componentKindSchema,
  instanceId: z.string().min(1).max(120),
  version: z.string().min(1).max(80),
  startedAt: z.string().datetime(),
  processId: z.number().int().positive().optional(),
  containerIdentity: z.string().min(1).max(200).optional(),
  buildIdentity: z.string().min(1).max(160),
  developmentGitCommit: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  protocols: z.object({
    runtimeApi: z.number().int().positive(),
    hub: z.number().int().positive().optional(),
  }),
});

export type ComponentInstanceIdentity = z.infer<
  typeof componentInstanceIdentitySchema
>;

export const componentCompatibilityRequirementSchema = z.object({
  runtimeApi: z.number().int().positive(),
  hub: z.number().int().positive().optional(),
  buildIdentity: z.string().min(1).max(160).optional(),
  developmentGitCommit: z.string().regex(/^[a-f0-9]{40}$/).optional(),
});

export type ComponentCompatibilityRequirement = z.infer<
  typeof componentCompatibilityRequirementSchema
>;

export function componentCompatibilityError(
  identity: ComponentInstanceIdentity,
  requirement: ComponentCompatibilityRequirement,
): string | undefined {
  if (identity.protocols.runtimeApi !== requirement.runtimeApi) {
    return "runtime_api_protocol_mismatch";
  }
  if (
    requirement.hub !== undefined &&
    identity.protocols.hub !== requirement.hub
  ) {
    return "hub_protocol_mismatch";
  }
  if (
    requirement.buildIdentity !== undefined &&
    identity.buildIdentity !== requirement.buildIdentity
  ) {
    return "build_identity_mismatch";
  }
  if (
    requirement.developmentGitCommit !== undefined &&
    identity.developmentGitCommit !== requirement.developmentGitCommit
  ) {
    return "development_commit_mismatch";
  }
  return undefined;
}
