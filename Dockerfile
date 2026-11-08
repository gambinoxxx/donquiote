# Donquixote worker (Railway). One long-running process: npm run worker.
# The dashboard is NOT built here; Vercel builds it from GitHub.
FROM node:24-slim

WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# Dependencies first (cached while package files don't change). Full install:
# the worker runs TypeScript with tsx and Prisma generates its client in
# postinstall, both dev dependencies.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund && npm cache clean --force

# The code (see .dockerignore: no .env*, docs, backtest data or builds).
COPY . .

ENV NODE_ENV=production
USER node

# npm forwards SIGTERM to the worker: it finishes the current cycle,
# releases the lock and exits 0 (see worker/index.ts).
CMD ["npm", "run", "worker"]
