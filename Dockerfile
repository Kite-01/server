# syntax=docker/dockerfile:1

ARG BUN_VERSION=1.4

FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS client

WORKDIR /app/client

COPY client/package.json client/bun.lock ./
RUN bun install --frozen-lockfile

COPY client/ ./
RUN bun run build

FROM oven/bun:${BUN_VERSION} AS deps

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:${BUN_VERSION}-slim

WORKDIR /app

ENV NODE_ENV=production \
    KITE_PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json LICENSE NOTICE.md ./
COPY drizzle ./drizzle
COPY src ./src
COPY --from=client /app/client/dist ./client/dist

USER bun
EXPOSE 3000

CMD ["sh", "-c", "bun src/db/migrate.ts && exec bun src/index.ts"]
