# syntax=docker/dockerfile:1
FROM nginxinc/nginx-unprivileged:1.31.7-alpine

# Fill in NGINX_LOCAL_RESOLVERS from /etc/resolv.conf before rendering the template.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d \
    API_UPSTREAM=api:4000 \
    WEB_UPSTREAM=web:8080

COPY templates/ /etc/nginx/templates/
# `auto` would start one worker per host CPU and ignore the container's CPU limit.
RUN sed -i 's/^worker_processes.*/worker_processes 2;/' /etc/nginx/nginx.conf
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/gateway/health || exit 1
