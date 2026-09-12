import { readFile, readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const sessionIdPattern = /^ses_[a-f0-9]{32}$/;
const evidenceDirectories = ["screenshots", "records", "pages", "files"];

function sessionDirectory(productHome, sessionId) {
  if (!sessionIdPattern.test(sessionId))
    throw new Error(`Invalid live session ID ${sessionId}.`);
  const sessionsRoot = resolve(productHome, "sessions");
  const directory = resolve(sessionsRoot, sessionId);
  if (!directory.startsWith(`${sessionsRoot}${sep}`))
    throw new Error("Live session path escaped the product home.");
  return directory;
}

async function readObservations(directory) {
  const raw = await readFile(join(directory, "observations.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readEvidence(directory) {
  const groups = await Promise.all(
    evidenceDirectories.map(async (subdirectory) => {
      const evidenceDirectory = join(directory, "evidence", subdirectory);
      let names;
      try {
        names = await readdir(evidenceDirectory);
      } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
      }
      return Promise.all(
        names
          .filter((name) => name.endsWith(".metadata.json"))
          .map(async (name) => {
            const metadata = JSON.parse(
              await readFile(join(evidenceDirectory, name), "utf8"),
            );
            let contentSignature = null;
            if (metadata.type === "file") {
              try {
                const payload = await readFile(
                  join(evidenceDirectory, `${metadata.id}.bin`),
                );
                const prefix = payload.subarray(0, 8).toString("ascii");
                contentSignature =
                  prefix.match(/^%PDF-\d(?:\.\d)?/)?.[0] ?? null;
              } catch (error) {
                if (error?.code !== "ENOENT") throw error;
              }
            }
            return { ...metadata, contentSignature };
          }),
      );
    }),
  );
  return groups.flat();
}

function referencedObservationIds(observations, evidence) {
  const ids = new Set(observations.map((observation) => observation.id));
  for (const observation of observations) {
    for (const key of ["observationId", "successorObservationId"])
      if (typeof observation.data?.[key] === "string")
        ids.add(observation.data[key]);
    for (const effect of observation.data?.effects ?? [])
      if (typeof effect.observationId === "string")
        ids.add(effect.observationId);
  }
  for (const item of evidence)
    if (typeof item.metadata?.observationId === "string")
      ids.add(item.metadata.observationId);
  return [...ids];
}

export async function loadLiveSessionLedger({ productHome, sessionId }) {
  const directory = sessionDirectory(productHome, sessionId);
  const [session, observations, evidence] = await Promise.all([
    readFile(join(directory, "session.json"), "utf8").then(JSON.parse),
    readObservations(directory),
    readEvidence(directory),
  ]);
  if (session.id !== sessionId)
    throw new Error(
      `Persisted live session identity mismatch for ${sessionId}.`,
    );

  const receipts = observations
    .filter((observation) => observation.type === "agent_interaction_receipt")
    .map((observation) => ({
      id: observation.data?.receiptId,
      observationId: observation.id,
      outcome: observation.data?.outcome,
      dispatched: observation.data?.dispatched,
      consequential: observation.data?.consequential,
      effects: observation.data?.effects ?? [],
    }));
  const downloads = observations
    .filter((observation) => observation.type === "download_completed")
    .map((observation) => ({
      observationId: observation.id,
      evidenceId: observation.data?.evidenceId,
      filename: observation.data?.filename,
      size: observation.data?.sizeBytes,
      mime: observation.data?.mimeType,
      mimeBasis: observation.data?.mimeTypeBasis,
      correlation: observation.data?.correlation,
    }));
  const downloadFileEvidence = evidence
    .filter(
      (item) =>
        item.type === "file" && item.metadata?.source === "browser_download",
    )
    .map((item) => ({
      evidenceId: item.id,
      filename: item.metadata?.filename,
      size: item.metadata?.sizeBytes,
      mime: item.metadata?.mimeType,
      mimeBasis: item.metadata?.mimeTypeBasis,
      contentSignature: item.contentSignature,
    }));

  return {
    sessionId,
    pageIds: [
      ...new Set([
        ...observations.flatMap((observation) =>
          [observation.pageId, observation.data?.pageId].filter(
            (value) => typeof value === "string",
          ),
        ),
        ...evidence
          .map((item) => item.pageId)
          .filter((value) => typeof value === "string"),
      ]),
    ],
    observationIds: referencedObservationIds(observations, evidence),
    evidenceIds: evidence.map((item) => item.id),
    screenshotEvidenceIds: evidence
      .filter((item) => item.type === "screenshot")
      .map((item) => item.id),
    receipts,
    downloads,
    downloadFileEvidence,
  };
}
