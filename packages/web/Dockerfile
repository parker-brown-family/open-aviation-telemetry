# The web client is a static bundle, so its runtime image contains no Node at
# all — just nginx and a directory of files. That keeps the published surface
# small and means the container has nothing in it that can execute application
# code.

FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

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

COPY tsconfig.base.json ./
COPY packages ./packages

# Baked in at build time, because a static bundle has no server to read
# configuration from at start-up. An empty value means "same origin", which is
# what the nginx proxy below relies on.
ARG VITE_API_BASE_URL=""
ARG VITE_BASE_PATH="/"
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN pnpm --filter @oat/web exec vite build --base "${VITE_BASE_PATH}"

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
