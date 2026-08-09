import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadConfig, isLoopbackHost } from "@rove/config";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  if (!isLoopbackHost(config.runtime.host)) {
    process.stderr.write("WARNING: Rove runtime is binding to a non-loopback address.\n");
  }
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });
  app.enableShutdownHooks();
  await app.listen(config.runtime.port, config.runtime.host);
}

void bootstrap();
