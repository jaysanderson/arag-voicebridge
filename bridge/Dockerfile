# ask-bridge — zero-dependency image. No npm install, no build step: the service is the
# Node standard library plus TypeScript run natively. Runs as the non-root `node` user.
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Source + config only — there are no node_modules to copy.
COPY package.json ./
COPY tsconfig.json ./
COPY src ./src
COPY config ./config

USER node
EXPOSE 8080
# --experimental-transform-types lets Node execute the .ts sources directly.
CMD ["node", "--experimental-transform-types", "src/index.ts"]
