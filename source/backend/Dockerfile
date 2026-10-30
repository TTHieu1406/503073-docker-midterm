# syntax=docker/dockerfile:1
#
# One Dockerfile, four targets:
#   development  dependencies + source, restarts on change (compose.dev.yaml)
#   test         lint and unit tests, fails the build if they fail
#   build        production dependencies only (never shipped by itself)
#   production   the smallest runnable image (default target)

ARG NODE_VERSION=24.22.2-alpine3.24

FROM node:${NODE_VERSION} AS base
WORKDIR /app
# package files are copied before the source. A source change therefore keeps the
# cached dependency layers, and a rebuild takes seconds instead of minutes.
COPY package.json package-lock.json ./

FROM base AS dev-deps
RUN npm ci --no-audit --no-fund

FROM dev-deps AS development
ENV NODE_ENV=development
COPY . .
CMD ["node", "--watch", "src/server.js"]

FROM dev-deps AS test
ENV NODE_ENV=test
COPY . .
RUN npm run lint && npm test

FROM base AS build
ENV NODE_ENV=production
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:${NODE_VERSION} AS production
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="dockmart-backend" \
      org.opencontainers.image.version="${APP_VERSION}"
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations
# The official image ships an unprivileged `node` user. Never run as root.
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:4000/health/live || exit 1
# Exec form: node is PID 1 and receives SIGTERM directly. `npm start` would swallow it.
CMD ["node", "src/server.js"]
