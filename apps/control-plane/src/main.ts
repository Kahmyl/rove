import { RelayServer } from "./relay-server.js";
import {
  ROVE_HUB_PROTOCOL_VERSION,
  ROVE_PROTOCOL_VERSION,
  componentCompatibilityError,
} from "@rove/protocol";
import { CONTROL_PLANE_PROVENANCE } from "./component-provenance.js";

const expectedBuildIdentity = process.env.ROVE_EXPECTED_BUILD_ID?.trim();
const expectedDevelopmentCommit =
  process.env.ROVE_EXPECTED_DEVELOPMENT_COMMIT?.trim();
const expectedRuntime = {
  runtimeApi: ROVE_PROTOCOL_VERSION,
  hub: ROVE_HUB_PROTOCOL_VERSION,
  ...(expectedBuildIdentity === undefined || expectedBuildIdentity === ""
    ? {}
    : { buildIdentity: expectedBuildIdentity }),
  ...(expectedDevelopmentCommit === undefined || expectedDevelopmentCommit === ""
    ? {}
    : { developmentGitCommit: expectedDevelopmentCommit }),
};
const ownMismatch = componentCompatibilityError(
  CONTROL_PLANE_PROVENANCE,
  expectedRuntime,
);
if (ownMismatch !== undefined) {
  throw new Error(
    `Control Plane build does not satisfy its configured compatibility requirement: ${ownMismatch}.`,
  );
}

const server = new RelayServer({
  host: process.env.ROVE_CONTROL_PLANE_HOST ?? "127.0.0.1",
  port: Number(process.env.ROVE_CONTROL_PLANE_PORT ?? 47_830),
  hubToken: process.env.ROVE_HUB_TOKEN ?? "rove-local-hub-token-change-me",
  serviceToken:
    process.env.ROVE_CONTROL_PLANE_SERVICE_TOKEN ??
    "rove-local-service-token-change-me",
  expectedRuntime,
});

await server.start();
process.stdout.write("Rove control plane listening.\n");

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
