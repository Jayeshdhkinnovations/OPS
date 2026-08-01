#!/bin/sh
set -e

# Backend listens on 127.0.0.1:8081 internally - nothing outside this
# container ever calls it directly, only this container's own Nginx.
export PORT=8081

# PUBLIC_ORIGIN, MASTER_KEY, APP_ID, SUPERADMIN_MONGODB_URI, and
# INTERNAL_ADMIN_SECRET all come from `docker run -e ...` - not baked into
# the image, so the same image works against any domain/database/secret.

node index.js &
nginx -g "daemon off;"
