import "reflect-metadata";
import { connect } from "node:net";
import { Controller, Get, Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { IncomingMessage, ServerResponse } from "node:http";
import { expect, it } from "vitest";

// Maintainer advisory GHSA-9c5c-9qcx-q35q requires raw TCP: injection helpers
// normalize the absolute-form target and can conceal the vulnerable behavior.
it("patched Nest/Fastify cannot bypass path-scoped middleware with absolute-form request targets", async () => {
  let reached = 0;
  class ProtectedController {
    read() {
      reached++;
      return { protected: true };
    }
  }
  class FixtureModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
      consumer
        .apply((_request: IncomingMessage, response: ServerResponse) => {
          response.writeHead(401, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ denied: true }));
        })
        .forRoutes("v1/protected");
    }
  }
  Controller("v1/protected")(ProtectedController);
  Get()(
    ProtectedController.prototype,
    "read",
    Object.getOwnPropertyDescriptor(ProtectedController.prototype, "read")!,
  );
  Module({ controllers: [ProtectedController] })(FixtureModule);
  const app = await NestFactory.create<NestFastifyApplication>(
    FixtureModule,
    new FastifyAdapter({ logger: false }),
    { logger: false, abortOnError: false },
  );
  try {
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    for (const target of ["/v1/protected", `http://127.0.0.1:${address.port}/v1/protected`]) {
      const result = await new Promise<string>((resolve, reject) => {
        const socket = connect(address.port, "127.0.0.1");
        let data = "";
        socket.setTimeout(2000, () => socket.destroy(new Error("Fixture request timed out")));
        socket.on("error", reject);
        socket.on("data", (part: Buffer) => {
          data += part.toString();
        });
        socket.on("end", () => resolve(data));
        socket.on("connect", () =>
          socket.write(
            `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${address.port}\r\nConnection: close\r\n\r\n`,
          ),
        );
      });
      expect(result).toMatch(/^HTTP\/1\.1 401 /);
      expect(result).toContain('"denied":true');
      expect(result).not.toContain('"protected":true');
    }
    expect(reached).toBe(0);
  } finally {
    await app.close();
  }
});
