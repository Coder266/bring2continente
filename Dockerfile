# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    UI_DIR=/app/dist/web \
    CONTINENTE_MCP_COMMAND=/app/node_modules/.bin/continentept-mcp \
    CONTINENTE_UPDATE_CHECK=0 \
    DATA_DIR=/data \
    CONTINENTE_DATA_DIR=/continente \
    HOST=0.0.0.0 \
    PORT=8093

# Chromium and the system libraries the MCP browser needs.
COPY --from=build /app/node_modules ./node_modules
RUN npx playwright install --with-deps chromium \
  && chmod -R a+rX /ms-playwright

COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

RUN mkdir -p /data /continente && chown -R node:node /data /continente /app
USER node

EXPOSE 8093
VOLUME ["/data", "/continente"]
CMD ["node", "dist/index.js"]
