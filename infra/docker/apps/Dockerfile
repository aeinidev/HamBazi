FROM node:24.20.0-alpine3.24@sha256:4caaaf42195bcd6f6f3559a413b20cb8f8ad089e231ee874cf7701643966689f AS build
WORKDIR /source
RUN npm install --global --ignore-scripts corepack@0.35.0 && corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
ENV NODE_ENV=production TURBO_CONCURRENCY=1 TURBO_FORCE=true TURBO_CACHE=local:rw
ARG VITE_API_ORIGIN
ARG VITE_KAHROBA_RUNTIME=false
ARG HAMBAZI_WEB_ORIGIN
ARG HAMBAZI_WEB_FRAME_ANCESTORS=[]
ENV HAMBAZI_WEB_POLICY_PROFILE=production
RUN pnpm build
RUN pnpm --filter @hambazi/api deploy --prod /out/api && \
    pnpm --filter @hambazi/bot deploy --prod /out/bot && \
    pnpm --filter @hambazi/worker deploy --prod /out/worker

FROM node:24.20.0-alpine3.24@sha256:4caaaf42195bcd6f6f3559a413b20cb8f8ad089e231ee874cf7701643966689f AS runtime
COPY .build-inputs/*.apk /tmp/hambazi-apk/
RUN --network=none apk add --no-network /tmp/hambazi-apk/*.apk && rm -rf /tmp/hambazi-apk
RUN rm -rf /usr/local/lib/node_modules /opt/yarn* && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/corepack
WORKDIR /app
ENV NODE_ENV=production
ARG SOURCE_COMMIT
ARG SOURCE_SNAPSHOT
ARG BUILD_INPUT
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT \
      io.hambazi.source-snapshot-sha256=$SOURCE_SNAPSHOT \
      io.hambazi.build-input-sha256=$BUILD_INPUT \
      io.hambazi.purpose=local-packaging-candidate
COPY infra/docker/apps/healthcheck.mjs /opt/hambazi/healthcheck.mjs
USER 1000:1000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 CMD ["node", "/opt/hambazi/healthcheck.mjs"]
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning"]

FROM runtime AS api
ENV HAMBAZI_SERVICE=api API_HEALTH_PORT=8081
COPY --from=build /out/api /app
CMD ["dist/composition/main.js"]

FROM runtime AS bot
ENV HAMBAZI_SERVICE=bot BOT_HEALTH_PORT=8081
COPY --from=build /out/bot /app
CMD ["dist/composition/main.js"]

FROM runtime AS worker
ENV HAMBAZI_SERVICE=worker WORKER_HEALTH_PORT=8081
COPY --from=build /out/worker /app
CMD ["dist/composition/main.js"]

FROM runtime AS web
ENV HAMBAZI_SERVICE=web WEB_PORT=8080 WEB_HEALTH_PORT=8081 WEB_BIND_ADDRESS=0.0.0.0
COPY apps/web/package.json /app/package.json
COPY --from=build /source/apps/web/dist/client /app/dist/client
COPY apps/web/server /app/server
COPY apps/web/security/browser-policy.ts /app/security/browser-policy.ts
COPY apps/web/src/platform/telegram-sdk.ts /app/src/platform/telegram-sdk.ts
CMD ["server/serve.mjs"]
