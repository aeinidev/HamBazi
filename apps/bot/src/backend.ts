import { request, Agent } from "node:https";
import { currentCorrelation } from "@hambazi/observability";
import { z } from "zod";
import { healthPaths } from "@hambazi/observability";
import {
  botInternalPaths,
  botExperiencePaths,
  botAdmissionResultSchema,
  botProcessedSchema,
  botAcknowledgedSchema,
  botOnboardingUpdateSchema,
  botOnboardingAckSchema,
} from "@hambazi/api/auth";
export type OnboardingUpdate = z.infer<typeof botOnboardingUpdateSchema>;
export type Delivery = Extract<z.infer<typeof botProcessedSchema>, { status: "REPLY" }>["delivery"];
export type SupportDelivery = Extract<
  z.infer<typeof botProcessedSchema>,
  { status: "SUPPORT" }
>["delivery"];
export class RetryDelivery extends Error {
  constructor(readonly retryAfterSeconds = 1) {
    super("Bot delivery is incomplete");
  }
}
export interface Backend {
  admit(signal: AbortSignal): Promise<void>;
  process(
    update: OnboardingUpdate,
    signal: AbortSignal,
  ): Promise<z.infer<typeof botProcessedSchema>>;
  acknowledge(ack: z.infer<typeof botOnboardingAckSchema>, signal: AbortSignal): Promise<void>;
}
/** Fixed-origin HTTPS, no redirects, finite response size and absolute deadlines. */
export function createBackend(options: {
  origin: string;
  bearer: { reveal(): string };
  ca?: string;
  timeoutMs: number;
}) {
  let origin: URL;
  try {
    origin = new URL(options.origin);
  } catch {
    throw new Error("Invalid backend origin");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw new Error("Invalid backend origin");
  const agent = new Agent({
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 4,
    ...(options.ca ? { ca: options.ca } : {}),
  });
  async function call<T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    signal: AbortSignal,
    method: "POST" | "GET" = "POST",
  ): Promise<T> {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]);
    try {
      return await new Promise<T>((resolve, reject) => {
        const encoded = JSON.stringify(body);
        const req = request(
          new URL(path, origin),
          {
            method,
            agent,
            signal: bounded,
            headers: {
              ...(currentCorrelation() ? { traceparent: currentCorrelation()!.traceparent } : {}),
              authorization: options.bearer.reveal(),
              ...(method === "POST"
                ? {
                    "content-type": "application/json",
                    "content-length": Buffer.byteLength(encoded),
                  }
                : {}),
            },
            maxHeaderSize: 8192,
          },
          (res) => {
            if (res.statusCode !== 200) {
              const value = Number(res.headers["retry-after"]);
              res.destroy();
              reject(
                new RetryDelivery(Number.isInteger(value) && value >= 1 ? Math.min(value, 60) : 1),
              );
              return;
            }
            if (
              res.headers["content-type"]?.split(";")[0] !== "application/json" ||
              res.headers["content-encoding"]
            ) {
              res.destroy();
              reject(new RetryDelivery());
              return;
            }
            let size = 0;
            const chunks: Buffer[] = [];
            res.on("error", () => reject(new RetryDelivery()));
            res.on("aborted", () => reject(new RetryDelivery()));
            res.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > 32768) {
                res.destroy();
                reject(new RetryDelivery());
              } else chunks.push(chunk);
            });
            res.on("end", () => {
              try {
                resolve(schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
              } catch {
                reject(new RetryDelivery());
              }
            });
          },
        );
        req.on("error", () => reject(new RetryDelivery()));
        req.end(method === "POST" ? encoded : undefined);
      });
    } catch (error) {
      throw error instanceof RetryDelivery ? error : new RetryDelivery();
    }
  }
  const backend: Backend = {
    async admit(signal) {
      await call(botInternalPaths.admit, { schemaVersion: 1 }, botAdmissionResultSchema, signal);
    },
    async process(update, signal) {
      const parsed = botOnboardingUpdateSchema.safeParse(update);
      if (!parsed.success) throw new RetryDelivery();
      return call(botExperiencePaths.process, parsed.data, botProcessedSchema, signal);
    },
    async acknowledge(ack, signal) {
      const parsed = botOnboardingAckSchema.safeParse(ack);
      if (!parsed.success) throw new RetryDelivery();
      await call(botExperiencePaths.acknowledge, parsed.data, botAcknowledgedSchema, signal);
    },
  };
  return {
    backend,
    close: () => agent.destroy(),
    async probe(signal: AbortSignal) {
      try {
        const body = await call(
          healthPaths.ready,
          undefined,
          z.strictObject({
            schemaVersion: z.literal(1),
            status: z.literal("READY"),
          }),
          signal,
          "GET",
        );
        return body.status === "READY";
      } catch {
        return false;
      }
    },
  };
}
