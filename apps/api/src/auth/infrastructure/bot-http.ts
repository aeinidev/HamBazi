import "reflect-metadata";
import { Controller, Module, Post, Req, Res } from "@nestjs/common";
import type { FastifyRequest, FastifyReply } from "fastify";
import { createErrorEnvelope } from "@hambazi/contracts";
import type { BotOnboarding } from "../application/bot-onboarding.js";
import {
  legacyBotOnboardingUpdateSchema,
  legacyBotOnboardingAckSchema,
  botOnboardingUpdateSchema,
  botOnboardingAckSchema,
} from "../application/bot-onboarding.js";
import type { BotServiceContext } from "../application/bot-service.js";
import type { AuthRateLimiter } from "../application/rate-limit.js";
import { sendRateDecision } from "./http.js";
import {
  botAdmissionSchema,
  botProcessedSchema,
  legacyBotProcessedSchema,
  botAcknowledgedSchema,
} from "./bot-http-contract.js";

export function createBotInternalHttpModule(deps: {
  onboarding: BotOnboarding;
  limiter: AuthRateLimiter;
  context(request: FastifyRequest): BotServiceContext | undefined;
}) {
  function send(
    reply: FastifyReply,
    result:
      | Awaited<ReturnType<BotOnboarding["process"]>>
      | Awaited<ReturnType<BotOnboarding["acknowledge"]>>,
    ack: boolean,
    legacy = false,
  ) {
    if (!result.ok)
      return reply
        .code(result.error.code === "UNAUTHENTICATED" ? 401 : 400)
        .send(createErrorEnvelope(result.error.code));
    if (result.status === "RETRY")
      return reply.header("Retry-After", "1").code(503).send(createErrorEnvelope("INTERNAL_ERROR"));
    const parsed = (
      ack ? botAcknowledgedSchema : legacy ? legacyBotProcessedSchema : botProcessedSchema
    ).safeParse(result);
    return parsed.success
      ? reply.code(200).send(parsed.data)
      : reply.code(500).send(createErrorEnvelope("INTERNAL_ERROR"));
  }
  @Controller("v1/internal/bot")
  class BotInternalController {
    @Post("admit")
    async admit(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
      if (!deps.context(request))
        return reply.code(401).send(createErrorEnvelope("UNAUTHENTICATED"));
      if (!botAdmissionSchema.safeParse(request.body).success)
        return reply.code(400).send(createErrorEnvelope("INVALID_INPUT"));
      return reply.code(200).send({ schemaVersion: 1, ok: true });
    }
    @Post("experience/updates")
    async experience(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
      return this.process(request, reply, false);
    }
    @Post("updates")
    async process(@Req() request: FastifyRequest, @Res() reply: FastifyReply, legacy = true) {
      const context = deps.context(request);
      if (!context) return reply.code(401).send(createErrorEnvelope("UNAUTHENTICATED"));
      const parsed = (
        legacy ? legacyBotOnboardingUpdateSchema : botOnboardingUpdateSchema
      ).safeParse(request.body);
      if (!parsed.success || parsed.data.chatId !== parsed.data.senderId)
        return reply.code(400).send(createErrorEnvelope("INVALID_INPUT"));
      if (
        sendRateDecision(
          reply,
          await deps.limiter.consumeIdentity(`${context.botId}:${parsed.data.senderId}`),
        )
      )
        return;
      return send(
        reply,
        await (legacy
          ? deps.onboarding.processLegacy(context, parsed.data)
          : deps.onboarding.process(context, parsed.data)),
        false,
        legacy,
      );
    }
    @Post("experience/acknowledgements")
    async experienceAck(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
      return this.acknowledge(request, reply, false);
    }
    @Post("acknowledgements")
    async acknowledge(@Req() request: FastifyRequest, @Res() reply: FastifyReply, legacy = true) {
      const context = deps.context(request);
      if (!context) return reply.code(401).send(createErrorEnvelope("UNAUTHENTICATED"));
      const parsed = (legacy ? legacyBotOnboardingAckSchema : botOnboardingAckSchema).safeParse(
        request.body,
      );
      if (!parsed.success) return reply.code(400).send(createErrorEnvelope("INVALID_INPUT"));
      return send(reply, await deps.onboarding.acknowledge(context, parsed.data), true);
    }
  }
  @Module({ controllers: [BotInternalController] })
  class BotInternalHttpModule {}
  return BotInternalHttpModule;
}
