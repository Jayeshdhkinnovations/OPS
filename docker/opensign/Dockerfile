# Combined OpenSign container: same pattern as docker/superadmin - builds
# the OpenSign frontend, packages it with OpenSignServer (backend) in one
# image. Nginx serves the built frontend and forwards /app/* to the
# backend, which listens on 127.0.0.1:8081 - both processes share one
# container, so 127.0.0.1 correctly reaches between them.
#
# Each company runs in its OWN container off this same image, with its own
# database; this root container proxies /app/<slug> to it (see
# cloud/multiTenant.js). Parse keeps applicationId/serverURL as process
# globals, so two companies in one process overwrite each other - hence
# one process each.
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
ARG VITE_SIGNATURE_TRUST_ANCHORS=[]
ENV REACT_APP_SERVERURL=$REACT_APP_SERVERURL
ENV REACT_APP_APPID=$REACT_APP_APPID
ENV VITE_SIGNATURE_TRUST_ANCHORS=$VITE_SIGNATURE_TRUST_ANCHORS
# npm run build also fetches the latest release tag from GitHub - needs
# network access during build, which the server has.
RUN npm run build

# ---- Stage 2: backend + Nginx serving the built frontend ----
FROM node:20-alpine
# docker-cli lets the root container start/stop the per-company containers
# (it talks to the host daemon through the mounted /var/run/docker.sock).
# libreoffice-writer provides the `soffice` binary that docxtopdf.js shells
# out to via the libreoffice-convert package - it was never installed here,
# so every DOCX->PDF conversion failed at that step regardless of what made
# it past the upload filter (verified: `which soffice` found nothing in the
# running containers; adding this package and doing a real headless convert
# confirmed it produces valid PDF output).
RUN apk add --no-cache nginx docker-cli libreoffice-writer

WORKDIR /app
COPY apps/OpenSignServer/package*.json ./
RUN npm install --omit=dev
COPY apps/OpenSignServer/ ./

# Overrides parse-server's stock reset-password pages with our branded
# versions. These aren't reachable via any supported config option on the
# legacy PublicAPIRouter (pages.enableRouter is off), so the only place to
# put them is directly over the package's own template files - which must
# happen AFTER npm install, since that's what puts them there in the first
# place, and every image rebuild reinstalls node_modules from scratch.
RUN cp customPages/choose_password.html node_modules/parse-server/views/choose_password && \
    cp customPages/password_reset_success.html node_modules/parse-server/public_html/password_reset_success.html && \
    cp customPages/invalid_link.html node_modules/parse-server/public_html/invalid_link.html

# Note: build output is "build/", not "dist/" - kept as-is for CRA compatibility.
COPY --from=frontend-build /frontend/build /usr/share/nginx/html
COPY docker/opensign/nginx.conf /etc/nginx/http.d/default.conf
RUN sed -i 's/worker_processes auto;/worker_processes 2;/' /etc/nginx/nginx.conf
COPY docker/opensign/start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 80
CMD ["/start.sh"]
