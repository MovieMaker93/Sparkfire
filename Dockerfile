FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ARG APP_VERSION=development
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg poppler-utils curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=54321 DATA_DIR=/data REDIS_URL=redis://redis:6379 SPARKFIRE_VERSION=$APP_VERSION
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/dist-client ./dist-client
EXPOSE 54321
VOLUME ["/data"]
CMD ["node", "dist-server/server/index.js"]
