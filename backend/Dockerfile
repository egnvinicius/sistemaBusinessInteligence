# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- produção ----------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3333 \
    UPLOAD_DIR=/app/uploads
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
EXPOSE 3333
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3333/api/health || exit 1
# As migrações rodam automaticamente na inicialização
CMD ["node", "dist/server.js"]
