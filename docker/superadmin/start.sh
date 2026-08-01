#!/bin/sh
set -e

# Backend needs to know it's reachable at /app on its own origin - always
# 127.0.0.1 here, since nothing outside this container ever calls it
# directly (Nginx is the only public-facing thing).
export PORT=9000
export SERVER_URL="http://127.0.0.1:9000/app"

# MONGODB_URI, MASTER_KEY, APP_ID come from `docker run -e ...` - not baked
# into the image, so the same image works against any database.

node index.js &
nginx -g "daemon off;"
