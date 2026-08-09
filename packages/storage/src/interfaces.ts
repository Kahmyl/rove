import type {
  Evidence,
  EvidencePayload,
  Observation,
  ObservationQuery,
  Session,
} from "@rove/protocol";

export interface SessionStore {
  create(session: Session): Promise<void>;
  get(id: string): Promise<Session | null>;
  update(session: Session): Promise<void>;
}

export interface ObservationStore {
  append(sessionId: string, observation: Observation): Promise<void>;
  list(sessionId: string, query?: ObservationQuery): Promise<Observation[]>;
}

export interface EvidenceStore {
  save(evidence: Evidence, payload: EvidencePayload): Promise<void>;
  list(sessionId: string): Promise<Evidence[]>;
  read(sessionId: string, evidenceId: string): Promise<EvidencePayload>;
}
