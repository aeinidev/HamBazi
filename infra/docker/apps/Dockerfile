FROM node:24.22.1-alpine3.24@sha256:1200d815de24f8dcca745fbf7651d166034a35adbcad8860a8538ffff44f1420 AS build
WORKDIR /source
ARG NPM_CONFIG_REGISTRY
ENV PNPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY:-https://registry.npmjs.org/}
ARG COREPACK_NPM_REGISTRY
ARG PRISMA_ENGINES_MIRROR
ARG NODE_EXTRA_CA_CERTS
RUN --mount=type=secret,id=hambazi_build_ca,target=/run/secrets/hambazi-build-ca.pem npm install --global --ignore-scripts corepack@0.35.0 && corepack enable
COPY . .
RUN --mount=type=secret,id=hambazi_build_ca,target=/run/secrets/hambazi-build-ca.pem pnpm install --frozen-lockfile
ENV NODE_ENV=production TURBO_CONCURRENCY=1 TURBO_FORCE=true TURBO_CACHE=local:rw
ARG VITE_API_ORIGIN
ARG VITE_KAHROBA_RUNTIME=false
ARG HAMBAZI_WEB_ORIGIN
ARG HAMBAZI_WEB_FRAME_ANCESTORS=[]
ENV HAMBAZI_WEB_POLICY_PROFILE=production
RUN --mount=type=secret,id=hambazi_build_ca,target=/run/secrets/hambazi-build-ca.pem pnpm build
RUN --mount=type=secret,id=hambazi_build_ca,target=/run/secrets/hambazi-build-ca.pem \
    --mount=type=tmpfs,target=/tmp/hambazi-deploy,size=2147483648 \
    pnpm --filter @hambazi/api deploy --prod /tmp/hambazi-deploy/api && \
    pnpm --filter @hambazi/bot deploy --prod /tmp/hambazi-deploy/bot && \
    pnpm --filter @hambazi/worker deploy --prod /tmp/hambazi-deploy/worker && \
    mkdir -p /out && cp -a /tmp/hambazi-deploy/api /tmp/hambazi-deploy/bot /tmp/hambazi-deploy/worker /out/

# pnpm deploy writes wall-clock bookkeeping and unordered dependency maps.
# Normalize those generated files only after its native supply-chain checks pass.
ARG SOURCE_DATE_EPOCH
RUN --network=none node --input-type=module <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { parse, stringify } = createRequire('/source/package.json')('yaml');
assert(/^[0-9]+$/.test(process.env.SOURCE_DATE_EPOCH ?? ''));
const at = Number(process.env.SOURCE_DATE_EPOCH) * 1000;
assert(Number.isSafeInteger(at) && at > 0);
const sorted = value => Array.isArray(value) ? value.map(sorted) :
  value !== null && typeof value === 'object' ?
    Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
for (const role of ['api', 'bot', 'worker']) {
  const root = `/out/${role}`;
  const modules = `${root}/node_modules/.modules.yaml`;
  const layout = JSON.parse(fs.readFileSync(modules, 'utf8'));
  assert(Number.isFinite(Date.parse(layout.prunedAt)));
  layout.prunedAt = new Date(at).toUTCString();
  fs.writeFileSync(modules, JSON.stringify(sorted(layout), null, 2) + '\n');
  const statePath = `${root}/node_modules/.pnpm-workspace-state-v1.json`;
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert(Number.isSafeInteger(state.lastValidatedTimestamp));
  state.lastValidatedTimestamp = at;
  fs.writeFileSync(statePath, JSON.stringify(sorted(state), null, 2) + '\n');
  const packagePath = `${root}/package.json`;
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'])
    if (manifest[field]) manifest[field] = sorted(manifest[field]);
  // Preserve conditional exports and every other order-sensitive manifest field.
  fs.writeFileSync(packagePath, JSON.stringify(manifest, null, 2) + '\n');
  const workspacePath = `${root}/pnpm-workspace.yaml`;
  const workspace = parse(fs.readFileSync(workspacePath, 'utf8'));
  assert.deepEqual(Object.keys(workspace), ['allowBuilds']);
  workspace.allowBuilds = sorted(workspace.allowBuilds);
  fs.writeFileSync(workspacePath, stringify(workspace));
}
NODE

FROM node:24.22.1-alpine3.24@sha256:1200d815de24f8dcca745fbf7651d166034a35adbcad8860a8538ffff44f1420 AS runtime
COPY .build-inputs/*.apk /tmp/hambazi-apk/
# Keep the base log unchanged; the retained build output records this installation.
RUN --network=none apk add --no-logfile --no-network /tmp/hambazi-apk/*.apk && rm -rf /tmp/hambazi-apk
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
