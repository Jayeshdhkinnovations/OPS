# Combined SuperAdmin container: builds the SuperAdminConsole frontend,
# then packages it together with SuperAdminServer (backend) in one image.
# Nginx serves the built frontend and forwards /app/* to the backend, which
# listens on 127.0.0.1:9000 - both processes share one container, so
# 127.0.0.1 correctly reaches between them. See start.sh for how both get
# launched.
#
# Build from the repo root (needs both apps/ folders in its context):
#   docker build -f docker/superadmin/Dockerfile -t superadmin-app .

# ---- Stage 1: build the frontend into static files ----
FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY apps/SuperAdminConsole/package*.json ./
RUN npm install
COPY apps/SuperAdminConsole/ ./

# Same-origin deployment - the frontend calls its own domain's /app path,
# so no absolute backend URL needs to be baked in at build time.
ARG VITE_SERVER_URL=/app
ARG VITE_APP_ID=superadmin
ARG VITE_USE_MOCKS=false
RUN npm run build

# ---- Stage 2: backend + Nginx serving the built frontend ----
FROM node:20-alpine
RUN apk add --no-cache nginx docker-cli

WORKDIR /app
COPY apps/SuperAdminServer/package*.json ./
RUN npm install --omit=dev
COPY apps/SuperAdminServer/ ./

COPY --from=frontend-build /frontend/dist /usr/share/nginx/html
COPY docker/superadmin/nginx.conf /etc/nginx/http.d/default.conf
# `worker_processes auto` picks one worker per CPU core Docker reports -
# on a small VM this can be surprisingly (and needlessly) high. Pin it to
# a small fixed number instead of relying on `auto`.
RUN sed -i 's/worker_processes auto;/worker_processes 2;/' /etc/nginx/nginx.conf
COPY docker/superadmin/start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 80
CMD ["/start.sh"]
