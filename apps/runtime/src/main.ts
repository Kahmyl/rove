import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadConfig } from "@rove/config";
import { AppModule } from "./app.module.js";
import { assertRuntimeBindingSafe } from "./api/runtime-auth.guard.js";
import {
  managedOwnerProcessId,
  startManagedOwnerLivenessMonitor,
} from "./managed-owner-liveness.js";

const ownerProcessId = managedOwnerProcessId(
  process.env.ROVE_RUNTIME_INSTANCE_ID,
  process.env.ROVE_RUNTIME_OWNER_PROCESS_ID,
);

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  assertRuntimeBindingSafe(config);
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
  });
  app.enableShutdownHooks();
  await app.listen(config.runtime.port, config.runtime.host);
  startManagedOwnerLivenessMonitor({
    managed: ownerProcessId !== undefined,
    ...(ownerProcessId === undefined ? {} : { ownerProcessId }),
    terminate: async () => {
      await app.close().catch(() => undefined);
      process.exit(0);
    },
  });
}

void bootstrap();
