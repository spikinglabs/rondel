# Rondel on any container platform: the app plus the Node room server, meetings in /data.
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
COPY package.json ./
RUN mkdir -p /data && chown node /data
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "--import", "tsx", "server/node/server.ts"]
