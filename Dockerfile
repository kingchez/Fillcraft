FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    fontconfig \
    libfreetype6 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

COPY server/ ./server/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

WORKDIR /app/server
CMD ["node", "src/index.js"]
