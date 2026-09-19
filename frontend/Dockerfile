# ---- build stage: compile the React/Vite SPA -------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first for layer caching (lock file optional).
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund

COPY . .

# VITE_API_URL stays unset on purpose: the runtime container serves the SPA
# and the API on the same origin, so the client uses relative URLs and the
# WebSocket connects to window.location.host — no rebuild-time API host.
RUN npm run build

# ---- runtime stage: nginx serves the SPA and proxies to the API ------------
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1