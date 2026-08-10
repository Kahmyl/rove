import { createServer, type Server } from "node:net";

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function allocateLoopbackPort(): Promise<number> {
  const server = createServer();

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error);
    };

    server.once("error", onError);

    server.listen(
      {
        host: "127.0.0.1",
        port: 0,
        exclusive: true,
      },
      () => {
        server.off("error", onError);
        resolve();
      },
    );
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    await closeServer(server);

    throw new Error("Rove Desktop could not allocate a loopback port.");
  }

  const port = address.port;

  await closeServer(server);

  return port;
}
