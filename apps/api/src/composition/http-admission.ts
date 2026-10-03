import type { FastifyInstance, FastifyRequest } from "fastify";
import { createErrorEnvelope } from "@hambazi/contracts";
import { transportAdmissionPolicySchema, type TransportAdmissionPolicy } from "@hambazi/config";
import { authPaths } from "../auth/index.js";
import type { IpAdmission } from "../realtime/index.js";

export interface HttpAdmission {
  policy: TransportAdmissionPolicy;
  ip: IpAdmission;
}
export function installHttpAdmission(server: FastifyInstance, admission: HttpAdmission) {
  const policy = transportAdmissionPolicySchema.parse(admission.policy);
  let active = 0;
  const leases = new WeakMap<
    FastifyRequest,
    { checking: boolean; handling: boolean; ended: boolean; released: boolean }
  >();
  const release = (request: FastifyRequest) => {
    const lease = leases.get(request);
    if (lease && lease.ended && !lease.checking && !lease.handling && !lease.released) {
      lease.released = true;
      active--;
    }
  };
  const end = (request: FastifyRequest) => {
    const lease = leases.get(request);
    if (lease) lease.ended = true;
    release(request);
  };
  // Hold through actual application completion, including when a client aborts.
  server.addHook("onRoute", (route) => {
    const handler = route.handler;
    route.handler = async function (request, reply) {
      const lease = leases.get(request);
      if (lease) lease.handling = true;
      try {
        return await handler.call(this, request, reply);
      } finally {
        if (lease) lease.handling = false;
        release(request);
      }
    };
  });
  server.addHook("onRequest", async (request, reply) => {
    if (active >= policy.maxHttpInFlight)
      return reply.header("Retry-After", "1").code(429).send(createErrorEnvelope("RATE_LIMITED"));
    active++;
    const lease = { checking: true, handling: false, ended: false, released: false };
    leases.set(request, lease);
    request.raw.once("aborted", () => end(request));
    reply.raw.once("close", () => end(request));
    try {
      const decision = await admission
        .ip(request.ip, "http")
        .catch(() => ({ allowed: false as const, reason: "unavailable" as const }));
      if (!decision.allowed) {
        if (decision.reason === "limited")
          return reply
            .header("Retry-After", String(decision.retryAfterSeconds))
            .code(429)
            .send(createErrorEnvelope("RATE_LIMITED"));
        // Preserve existing Redis-outage policies; owning read ports still enforce theirs.
        const durable =
          request.method === "GET" ||
          request.method === "HEAD" ||
          (request.method === "POST" && request.routeOptions.url === authPaths.logout);
        if (!durable) return reply.code(503).send(createErrorEnvelope("INTERNAL_ERROR"));
      }
    } finally {
      lease.checking = false;
      release(request);
    }
  });
  server.addHook("onResponse", async (request) => end(request));
  server.addHook("onTimeout", async (request) => end(request));
}
