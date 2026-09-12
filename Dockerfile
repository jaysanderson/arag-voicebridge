# VoiceBridge — zero-dependency runtime image. No npm, no build step: Node runs the TypeScript
# sources directly (erasable syntax only). Runs as the non-root `node` user.
FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
COPY config ./config
COPY public ./public
COPY admin ./admin
COPY vendor ./vendor
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.ts"]
