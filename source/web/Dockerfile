# syntax=docker/dockerfile:1
#
# Node is only needed to compile the React app. The final image is an unprivileged
# Nginx serving static files, so Node, npm and node_modules never reach production.

ARG NODE_VERSION=24.22.2-alpine3.24
ARG NGINX_VERSION=1.31.7-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS development
ENV NODE_ENV=development
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

FROM deps AS test
COPY . .
RUN npm test

FROM deps AS build
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:${NGINX_VERSION} AS production
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# `auto` would start one worker per host CPU and ignore the container's CPU limit.
RUN sed -i 's/^worker_processes.*/worker_processes 2;/' /etc/nginx/nginx.conf
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
