import type { Recording, RecordingArtifact } from "@rove/protocol";

export interface RecordingStore {
  create(recording: Recording): Promise<Recording>;
  update(
    sessionId: string,
    recordingId: string,
    expectedState: Recording["state"],
    next: Recording,
  ): Promise<Recording>;
  get(sessionId: string, recordingId: string): Promise<Recording | null>;
  list(sessionId: string): Promise<Recording[]>;
  listAll(): Promise<Recording[]>;
  stagingPath(sessionId: string, recordingId: string): Promise<string>;
  finalizeArtifact(
    sessionId: string,
    recordingId: string,
  ): Promise<RecordingArtifact>;
  preservePartialArtifact(
    sessionId: string,
    recordingId: string,
  ): Promise<RecordingArtifact | null>;
  artifactPath(
    sessionId: string,
    recordingId: string,
    partial: boolean,
  ): Promise<string>;
}
