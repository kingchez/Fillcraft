# ---- Stage 1: build the admin frontend ----
FROM node:22-bookworm-slim AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---- Stage 2: server + runtime ----
FROM node:22-bookworm-slim
WORKDIR /app

# @napi-rs/canvas ships prebuilt binaries for most platforms, but a few
# system libs (fontconfig, freetype) are still needed at runtime for
# consistent font rendering across environments.
RUN apt-get update && apt-get install -y --no-install-recommends \
    fontconfig \
    libfreetype6 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

COPY server/ ./server/
COPY --from=web-build /app/web/dist ./web/dist

ENV NODE_ENV=production
ENV PORT=3000

# No VOLUME here on purpose — this app has no persistent local disk at all.
# Every user-owned asset (designs, uploads, custom fonts) lives in Supabase
# only. The only thing written to disk at runtime is an ephemeral font
# cache under the OS temp dir (see server/src/services/fontCache.js),
# which is fine to lose on every restart/redeploy and is never meant to
# persist across them.
EXPOSE 3000

WORKDIR /app/server
CMD ["node", "src/index.js"]
