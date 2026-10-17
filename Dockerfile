# Rondel on any container platform: the app plus the Node room server, meetings in /data.
# SITE_CONFIG=/path/to/site.json applies your settings (and the templates/ folder next to it) at start;
# see DEPLOY.md and deploy/example/.
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data STATIC_DIR=/app/dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/scripts ./scripts
COPY package.json ./
RUN mkdir -p /data && chown node /data && chown -R node /app/dist
VOLUME /data
EXPOSE 8787
USER node
ENV RONDEL_DIST=/app/dist/
CMD ["sh", "-c", "if [ -n \"$SITE_CONFIG\" ]; then node scripts/site-config.mjs \"$SITE_CONFIG\" || exit 1; fi; exec node --import tsx server/node/server.ts"]
