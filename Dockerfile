# Move-in Ready production image (see meta-inspect-delivery/azure-aca-plan.md).
# Multi-stage: bounded FFmpeg runtime, deps, Next.js standalone build, minimal run.
FROM node:22-alpine AS ffmpeg
WORKDIR /ffmpeg-src
RUN apk add --no-cache bash curl gnupg tar xz make gcc musl-dev nasm
COPY scripts/install-ffmpeg-runtime.sh ./scripts/
ENV FFMPEG_INSTALL_PREFIX=/opt/ffmpeg FFMPEG_BUILD_JOBS=4
RUN bash ./scripts/install-ffmpeg-runtime.sh

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
ENV FFMPEG_PATH=/opt/ffmpeg/bin/ffmpeg
RUN addgroup -S app && adduser -S app -G app
COPY --from=ffmpeg /opt/ffmpeg /opt/ffmpeg
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
