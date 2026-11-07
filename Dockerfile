FROM node:22-alpine AS base
WORKDIR /app

# 1. Install dependencies
FROM base AS deps
COPY package.json ./
RUN npm install --legacy-peer-deps

COPY mini-services/realtime/package.json ./mini-services/realtime/
RUN cd mini-services/realtime && npm install

# 2. Build Next.js application
FROM base AS builder
ARG NEXT_PUBLIC_REALTIME_PORT=3003
ENV REALTIME_PORT=3003
ENV REALTIME_URL=http://localhost:3003
ENV NEXT_PUBLIC_REALTIME_PORT=$NEXT_PUBLIC_REALTIME_PORT
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# 3. Production runner (Node.js 22 + Python 3 Multi-Runtime for Shopee 24/7)
FROM node:22-alpine AS runner
WORKDIR /app

# Install Python 3 & pip & ca-certificates for Shopee Daemon
RUN apk add --no-cache python3 py3-pip py3-websockets ca-certificates

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV REALTIME_PORT=3003
ENV REALTIME_URL=http://localhost:3003
ENV NEXT_PUBLIC_REALTIME_PORT=3003
ENV DATABASE_URL=file:/app/db/custom.db

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/db ./db
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/mini-services/realtime ./mini-services/realtime
COPY --from=deps /app/mini-services/realtime/node_modules ./mini-services/realtime/node_modules

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/health >/dev/null || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
