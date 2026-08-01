# Combined OpenSign container: same pattern as docker/superadmin - builds
# the OpenSign frontend, packages it with OpenSignServer (backend) in one
# image. Nginx serves the built frontend and forwards /app/* to the
# backend, which listens on 127.0.0.1:8081 - both processes share one
# container, so 127.0.0.1 correctly reaches between them.
#
# Unlike SuperAdmin, this backend hosts multiple companies at once (see
# cloud/multiTenant.js) - each company's own login lives at /app/<slug>,
# all inside this one running process.
#
# Build from the repo root (needs both apps/ folders in its context):
#   docker build -f docker/opensign/Dockerfile -t opensign-app .

# ---- Stage 1: build the frontend into static files ----
FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY apps/OpenSign/package*.json ./
RUN npm install
COPY apps/OpenSign/ ./

# Same-origin deployment - the frontend calls its own domain's /app path,
# so no absolute backend URL needs to be baked in at build time.
ARG REACT_APP_SERVERURL=/app
ARG REACT_APP_APPID=opensign
ENV REACT_APP_SERVERURL=$REACT_APP_SERVERURL
ENV REACT_APP_APPID=$REACT_APP_APPID
# npm run build also fetches the latest release tag from GitHub - needs
# network access during build, which the server has.
RUN npm run build

# ---- Stage 2: backend + Nginx serving the built frontend ----
FROM node:20-alpine
RUN apk add --no-cache nginx

WORKDIR /app
COPY apps/OpenSignServer/package*.json ./
RUN npm install --omit=dev
COPY apps/OpenSignServer/ ./

# Note: build output is "build/", not "dist/" - kept as-is for CRA compatibility.
COPY --from=frontend-build /frontend/build /usr/share/nginx/html
COPY docker/opensign/nginx.conf /etc/nginx/http.d/default.conf
RUN sed -i 's/worker_processes auto;/worker_processes 2;/' /etc/nginx/nginx.conf
COPY docker/opensign/start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 80
CMD ["/start.sh"]
