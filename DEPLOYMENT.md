# Docker Deployment Guide

Production deployment for the Raffle Ticket Reservation system using Docker
Compose.

## Architecture

```
                        jdp-network (external, shared)
        ┌────────────────────────┬───────────────────────────┐
        │                        │                           │
┌───────▼────────┐      ┌────────▼─────────┐                 │
│ raffle-ticket- │ /api │ raffle-ticket-   │  /data          │
│      web       │─────►│      api         │  (SQLite volume)│
│  nginx :80     │ /ws  │  daphne :8000    │                 │
│  SPA + proxy   │      │  Django 5 ASGI   │  /app/media     │
└───────┬────────┘      └──────────────────┘  (backgrounds)  │
        │                             ▲                      │
        │ /media/  /static/           │ writes               │
        └──────► shared volumes ◄─────┘                      │
```

- **raffle-ticket-api** — Django 5 on daphne (keeps the `/ws/reservations/`
  WebSocket alive). On start it runs `migrate`, `collectstatic` and
  `create_default_admin` (idempotent) before serving.
- **raffle-ticket-web** — nginx serving the compiled React SPA. It
  reverse-proxies `/api/` and `/ws/` (with WebSocket upgrade) to the API
  container and serves `/media/` (uploaded ticket backgrounds) and
  `/static/` (Django admin assets) straight from shared volumes, because
  Django stops serving both when `DEBUG=0`.
- Same-origin by design: the client uses relative API URLs and connects its
  WebSocket to `window.location.host`, so no rebuild-time API host is needed.

## One-time preparation

1. Create the shared network (skip if it already exists):

   ```bash
   docker network create jdp-network
   ```

2. Configure the environment:

   ```bash
   cp .env.example .env
   # then edit .env — DJANGO_SECRET_KEY and RAFFLE_ADMIN_PASSWORD are the
   # two values you really must set.
   ```

## Build & run

```bash
docker compose build
docker compose up -d
docker compose ps          # both services should report "healthy"
docker compose logs -f     # watch migrations + daphne startup
```

The app is then served at `http://<host>:8080` (change with `RAFFLE_WEB_PORT`
in `.env`). Log in with the admin credentials from `.env`.

## Upgrading

```bash
git pull
docker compose build
docker compose up -d      # migrations run automatically on API start
```

## Backups

Everything stateful lives in three named volumes:

| Volume              | Contents                                  |
| ------------------- | ----------------------------------------- |
| `raffle-sqlite-data`| SQLite database (`/data/raffle.sqlite3`)  |
| `raffle-media`      | Uploaded ticket background images         |
| `raffle-static`     | `collectstatic` output (regenerable)      |

```bash
# Database backup
docker exec raffle-ticket-api python manage.py dumpsql  # (or:)
docker run --rm -v raffle-ticket-reservation_raffle-sqlite-data:/data \
  -v "$PWD:/backup" alpine cp /data/raffle.sqlite3 /backup/

# Media backup
docker run --rm -v raffle-ticket-reservation_raffle-media:/data \
  -v "$PWD:/backup" alpine tar czf /backup/raffle-media.tgz -C /data .
```

## Notes

- `DJANGO_DEBUG` defaults to `0`; Django then serves no static/media itself —
  the web container handles both.
- The channel layer is in-memory, which is correct for the single API
  container used here; switch to `channels_redis` only if you scale the API
  to multiple replicas.
- To hit the API directly (bypassing the proxy), uncomment the `ports` block
  under `raffle-ticket-api` and set `RAFFLE_API_PORT`.
- The network is declared `external: true` so the stack can talk to other
  containers already attached to `jdp-network`.