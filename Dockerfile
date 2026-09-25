# syntax=docker/dockerfile:1
#
# One image, two roles (see docker-compose.prod.yml): the default command runs the web server; the worker
# service overrides it to `npx tsx worker/index.ts`. The worker runs the real TypeScript source under tsx rather
# than a bundled build (see DECISIONS D-22 for why that's a real, if minor, limitation), so this image keeps the
# full dependency tree (including devDependencies: tsx, typescript) and the full source tree rather than trying
# to ship Next's pruned `.next/standalone` output alone.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
RUN apk add --no-cache tini

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3000
ENTRYPOINT ["tini", "--"]
CMD ["npm", "start"]
