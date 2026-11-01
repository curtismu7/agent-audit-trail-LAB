# Stage 1 builds the web UI (Vite). Stage 2 is the runtime: the server plus web/dist and the diagram data only, no build tools.
# No host tools in the image: nothing here can read the host, and the audit store is in-process and seeded.
# Node 26 only (rulebook). Docker on OrbStack, never Docker Desktop.
FROM node:26-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts -w web && npm cache clean --force
COPY web web
RUN npm run build -w web

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production AUDIT_TRAIL_PORT=6600
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server --ignore-scripts && npm cache clean --force
COPY server/src server/src
COPY server/diagrams server/diagrams
COPY --from=web /app/web/dist web/dist
USER node
EXPOSE 6600
# Inside the container the server must listen on all interfaces, so AUDIT_TRAIL_BIND is set here on purpose.
# The compose file publishes the port on 127.0.0.1 only; do not publish it more widely.
ENV AUDIT_TRAIL_BIND=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:6600/api/health').then(r=>r.json()).then(j=>process.exit(j.schema==='demo-health/1'&&j.state==='ready'?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server/src/index.js"]
