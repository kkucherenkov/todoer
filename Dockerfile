# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
# The version comes from package.json's `packageManager` (pnpm 9.12.0).
RUN corepack enable
# Prisma picks its engine build from the OpenSSL it finds; without it, 1.1.x.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -w exec turbo run build --filter=@todoer/backend... --filter=@todoer/web...
RUN pnpm --filter @todoer/backend deploy --prod /out
# `pnpm deploy` does not run postinstall: generate the client and engines here.
RUN cd /out && node_modules/.bin/prisma generate

FROM node:24-bookworm-slim
# Prisma's query engine links against OpenSSL 3.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
# The backend resolves the OpenAPI document three directories above dist/
# (create-app.ts), so the image keeps the repository's apps/ and packages/ shape.
WORKDIR /app/apps/backend
COPY --from=build --chown=node:node /out ./
COPY --from=build /src/packages/specs/openapi /app/packages/specs/openapi
COPY --from=build /src/apps/web/.output/public ./web
COPY docker/entrypoint.sh /entrypoint.sh
ARG APP_VERSION=0.0.0-dev
ENV NODE_ENV=production WEB_ROOT=/app/apps/backend/web PORT=3000 APP_VERSION=$APP_VERSION
USER node
EXPOSE 3000
HEALTHCHECK CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/entrypoint.sh"]
