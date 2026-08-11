import { RelayServer } from "./relay-server.js";

const server = new RelayServer({
  host: process.env.ROVE_CONTROL_PLANE_HOST ?? "127.0.0.1",
  port: Number(process.env.ROVE_CONTROL_PLANE_PORT ?? 47_830),
  hubToken: process.env.ROVE_HUB_TOKEN ?? "rove-local-hub-token-change-me",
  serviceToken:
    process.env.ROVE_CONTROL_PLANE_SERVICE_TOKEN ??
    "rove-local-service-token-change-me",
});

await server.start();
process.stdout.write("Rove control plane listening.\n");

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
