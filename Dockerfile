# One Dockerfile for all four Node services.
#
# They share a lockfile, a TypeScript config and a build command, so four
# near-identical Dockerfiles would be four places for the same fix to be needed
# and only applied to three. The service is selected with a build argument.
#
#   docker build --build-arg PACKAGE=@oat/telemetry-api -t oat/telemetry-api .
#
# Layer order is deliberate: manifests are copied and dependencies installed
# before any source is copied, so editing a source file does not invalidate the
# dependency layer.

# ---------------------------------------------------------------- base
FROM node:26-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------- deps
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/data/package.json ./packages/data/
COPY packages/service-kit/package.json ./packages/service-kit/
COPY packages/telemetry-api/package.json ./packages/telemetry-api/
COPY packages/telemetry-consumer/package.json ./packages/telemetry-consumer/
COPY packages/report-worker/package.json ./packages/report-worker/
COPY packages/simulator/package.json ./packages/simulator/
COPY packages/web/package.json ./packages/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---------------------------------------------------------------- build
FROM deps AS build
ARG PACKAGE
COPY tsconfig.base.json ./
COPY packages ./packages
# Build the whole workspace: pnpm resolves the topological order, so a service
# is never compiled before the shared package it imports.
RUN pnpm -r --filter "./packages/shared" --filter "./packages/data" \
             --filter "./packages/service-kit" --filter "${PACKAGE}" build
# `pnpm deploy` produces a self-contained directory holding just this package,
# its workspace dependencies and its production node_modules — no dev
# dependencies and no other service's code in the final image.
RUN pnpm --filter "${PACKAGE}" deploy --prod --legacy /out

# ---------------------------------------------------------------- runtime
FROM node:26-alpine AS runtime
ARG PACKAGE
ENV NODE_ENV=production

# wget is used by the container healthcheck; tini reaps zombies and forwards
# SIGTERM, which is what makes graceful shutdown work under an orchestrator.
RUN apk add --no-cache tini wget

# A dedicated unprivileged user. Running as root inside a container is a
# needless escalation path if the process is ever compromised.
RUN addgroup -g 10001 -S app && adduser -u 10001 -S app -G app

WORKDIR /app
COPY --from=build --chown=app:app /out ./

USER app
EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
