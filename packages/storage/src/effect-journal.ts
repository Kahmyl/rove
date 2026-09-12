export type EffectJournalState =
  "prepared" | "applied" | "not_applied" | "unresolved";

export interface EffectJournalRecord {
  schemaVersion: 1;
  effectId: string;
  version: number;
  taskScope: string;
  browserWorkspaceScope: string;
  consequenceKey: string;
  actionFingerprint: string;
  /** Retained as diagnostic metadata for records created by the removed
   * origin-scoped fence. It is never dispatch authority. */
  uncertaintyDomain?: string;
  /** Retained only to parse local development records written by the removed
   * automatic operation-distinctness experiment. It is not dispatch authority. */
  affectedOperationFingerprint?: string;
  /** Retained only for local development record compatibility. */
  affectedOperationIdentityVersion?: 1 | 2;
  /** Rove-owned identity for a new attempt admitted by trusted authorization. */
  attemptId?: string;
  state: EffectJournalState;
  ownershipGeneration: number;
  observationId?: string;
  evidenceId?: string;
  cutoverEpoch: string;
  preparedAt: string;
  updatedAt: string;
  repeatAuthorization?: {
    authorizationId: string;
    authorizedAt: string;
    consumedByAttemptId?: string;
    /** Parse-only compatibility for records written before attempt-owned
     * authorization consumption. It is never authorization authority. */
    consumedByConsequenceKey?: string;
    consumedAt?: string;
  };
}

export interface EffectJournalCutover {
  schemaVersion: 1;
  version: number;
  epoch: string;
  createdAt: string;
  legacyScopes: Record<string, { acknowledgedAt?: string }>;
}

export interface EffectJournalStore {
  prepare(
    record: Omit<EffectJournalRecord, "schemaVersion" | "version" | "effectId">,
  ): Promise<EffectJournalRecord>;
  update(
    effectId: string,
    expectedVersion: number,
    update: Pick<
      EffectJournalRecord,
      "state" | "updatedAt" | "observationId" | "evidenceId"
    > &
      Partial<Pick<EffectJournalRecord, "ownershipGeneration">>,
  ): Promise<EffectJournalRecord>;
  find(
    taskScope: string,
    browserWorkspaceScope: string,
    consequenceKey: string,
  ): Promise<EffectJournalRecord | null>;
  findById(effectId: string): Promise<EffectJournalRecord | null>;
  findPotentialConflicts(
    browserWorkspaceScope: string,
  ): Promise<EffectJournalRecord[]>;
  authorizeRepeat(
    effectId: string,
    authorizationId: string,
    authorizedAt: string,
  ): Promise<EffectJournalRecord>;
  consumeRepeatAuthorization(
    effectId: string,
    expectedVersion: number,
    attemptId: string,
    consumedAt: string,
  ): Promise<EffectJournalRecord>;
  establishCutover(
    epoch: string,
    createdAt: string,
    legacyScopes: readonly string[],
  ): Promise<EffectJournalCutover>;
  cutover(): Promise<EffectJournalCutover | null>;
  acknowledgeLegacyScope(scope: string, at: string): Promise<void>;
}
