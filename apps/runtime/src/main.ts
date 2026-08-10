import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadConfig } from "@rove/config";
import { AppModule } from "./app.module.js";
import { assertRuntimeBindingSafe } from "./api/runtime-auth.guard.js";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  assertRuntimeBindingSafe(config);
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });
  app.enableShutdownHooks();
  await app.listen(config.runtime.port, config.runtime.host);
}

void bootstrap();
