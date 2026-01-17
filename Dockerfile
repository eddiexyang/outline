ARG APP_PATH=/opt/outline

############################
# 1) Builder: use your exact flow
############################
FROM node:22.21.0 AS builder

ARG APP_PATH
WORKDIR ${APP_PATH}

COPY ./package.json ./yarn.lock ./.yarnrc.yml ./
COPY ./patches ./patches

RUN apt-get update && apt-get install -y cmake

ENV NODE_OPTIONS="--max-old-space-size=24000"

RUN corepack enable
RUN yarn install --immutable --network-timeout 1000000 \
  && yarn cache clean

COPY . .
ARG CDN_URL
RUN yarn build

RUN yarn workspaces focus --production \
  && yarn cache clean

############################
# 2) Runner: minimal runtime, copy artifacts
############################
FROM node:22.21.0-slim AS runner

ARG APP_PATH
WORKDIR ${APP_PATH}

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder ${APP_PATH}/build ./build
COPY --from=builder ${APP_PATH}/server ./server
COPY --from=builder ${APP_PATH}/public ./public
COPY --from=builder ${APP_PATH}/package.json ./package.json
COPY --from=builder ${APP_PATH}/.sequelizerc ./.sequelizerc
COPY --from=builder ${APP_PATH}/node_modules ./node_modules

# Optional: for HEALTHCHECK
RUN apt-get update && apt-get install -y --no-install-recommends wget \
  && rm -rf /var/lib/apt/lists/*

# Local file storage root (for FILE_STORAGE=local)
ENV FILE_STORAGE_LOCAL_ROOT_DIR=/var/lib/outline/data
RUN mkdir -p "${FILE_STORAGE_LOCAL_ROOT_DIR}"

VOLUME /var/lib/outline/data

HEALTHCHECK --interval=1m CMD wget -qO- "http://localhost:${PORT:-3000}/_health" | grep -q "OK" || exit 1

EXPOSE 3000
CMD ["node", "build/server/index.js"]
