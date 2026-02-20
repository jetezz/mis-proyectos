FROM oven/bun:1-alpine AS builder

WORKDIR /app
COPY package*.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .

FROM oven/bun:1-alpine AS runtime

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

EXPOSE 3000

CMD ["bun", "src/index.ts"]
