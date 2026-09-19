# Raffle Ticket Reservation

A simple, practical web system for managing raffle ticket number reservations.
An administrator reserves ticket numbers for customers; a read-only monitor
page displays reservation activity in real time on a second screen.

**Fast reservation → Accurate ticket tracking → Real-time visibility → Easy printing**

## Features

- **Ticket management** — configurable ticket range (e.g. `1 – 1000`) with
  zero-padded display (`0001`), unique numbers, Available/Reserved status.
- **Reservations** — one or many tickets per customer; name, optional contact
  number and notes. All-or-nothing: a request fails completely if any ticket is
  already reserved (`Ticket 0003 is already reserved.`).
- **Ticket selection grid** — click available tickets, search, or type numbers
  directly including ranges (`1, 2, 3, 10-15`).
- **Reservation list** — search by customer / contact / ticket number, status
  filter, sorting, pagination.
- **Cancellation** — cancelled tickets return to Available immediately.
- **Real-time monitoring** — `/monitor` page updates automatically over
  WebSockets (no refresh), with live stats, recent activity and a connection
  indicator (`● Live` / `○ Reconnecting...`).
- **Printing** — print-friendly ticket layout with configurable tickets per
  column (1–6) and print preview; navigation is hidden when printing.
- **Concurrency safety** — reservations run inside a DB transaction with row
  locking; two admins cannot reserve the same ticket (verified by tests).

## Tech Stack

| Layer     | Technology                                                     |
|-----------|----------------------------------------------------------------|
| Backend   | Python, Django, Django REST Framework, SQLite                  |
| Real-time | Django Channels + Daphne (WebSockets)                          |
| Auth      | JWT (`djangorestframework-simplejwt`)                          |
| Frontend  | React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui components |
| Routing   | React Router                                                   |

## Project Structure

```
backend/
├── manage.py
├── requirements.txt
├── config/           # settings, urls, asgi (HTTP + WebSocket)
├── accounts/         # auth endpoints, default admin command
└── raffle/           # models, serializers, views, services, consumers

frontend/
├── src/
│   ├── components/   # shared components + shadcn ui/
│   ├── layouts/      # app shell (sidebar nav)
│   ├── pages/        # Login, Dashboard, NewReservation, Reservations,
│   │                 # ReservationDetails, TicketMonitor, PrintPreview, Settings
│   ├── services/     # api client + per-domain service modules
│   ├── context/      # auth context
│   └── types/
└── vite.config.ts    # dev proxy: /api and /ws → http://127.0.0.1:8000
```

Reservation business logic lives in `backend/raffle/services.py` (transaction,
row locking, broadcasting) — not in views/serializers.

## Quick Start

Prerequisites: Python 3.12+, Node 18+.

### 1. Backend

```bash
cd backend
python3 -m venv ../.venv
../.venv/bin/pip install -r requirements.txt
../.venv/bin/python manage.py migrate
../.venv/bin/python manage.py create_default_admin   # admin / admin123
../.venv/bin/python manage.py runserver              # or: daphne config.asgi:application
```

Daphne is included, so `runserver` serves both HTTP and WebSockets in dev.
For production use:

```bash
.venv/bin/daphne -b 0.0.0.0 -p 8000 config.asgi:application
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 (proxies /api and /ws to :8000)
```

Production build (serve `dist/` from Nginx or any static server):

```bash
npm run build
```

### 3. First Run

1. Log in at `/login` (default `admin` / `admin123` — change it).
2. Open **Settings**, set the raffle name, ticket range (e.g. `1 – 1000`),
   padding (`4` → displays `0025`) and default tickets per column, then create
   the ticket range.
3. Go to **New Reservation**, enter the customer, pick tickets on the grid (or
   type `1, 2, 10-15`), and reserve.
4. Open `/monitor` on another screen to watch reservations arrive live.

## Environment Variables

Backend (all optional, sensible dev defaults):

| Variable                | Default               |
|-------------------------|-----------------------|
| `DJANGO_SECRET_KEY`     | dev key               |
| `DJANGO_DEBUG`          | `1`                   |
| `DJANGO_ALLOWED_HOSTS`  | `127.0.0.1,localhost` |
| `RAFFLE_ADMIN_USERNAME` | `admin`               |
| `RAFFLE_ADMIN_PASSWORD` | `admin123`            |

Frontend (for production builds):

| Variable       | Default             |
|----------------|---------------------|
| `VITE_API_URL` | same-origin `/api`  |
| `VITE_WS_URL`  | same-origin `/ws`   |

## API Overview

```
POST /api/auth/login/                     obtain JWT
POST /api/auth/refresh/                   refresh JWT
GET  /api/dashboard/                      stats (auth)
GET  /api/tickets/?status=&search=        ticket grid data (auth)
GET  /api/reservations/                   list + filters (auth)
POST /api/reservations/                   create reservation (auth)
GET  /api/reservations/{id}/              details (auth)
POST /api/reservations/{id}/cancel/       cancel (auth)
GET  /api/monitor/                        stats (public, read-only)
GET/PUT /api/settings/                    raffle settings (auth)
POST /api/settings/initialize-tickets/    (re)create ticket range (auth)
WS   /ws/reservations/                    live reservation_created /
                                         reservation_cancelled events
```

## Tests

```bash
cd backend
../.venv/bin/python manage.py test raffle
```

Covers ticket generation, reservation rules (duplicates, already-reserved,
invalid, empty), cancellation, availability restore, concurrency
(two simultaneous reservations of the same ticket → exactly one succeeds) and
the WebSocket broadcast path.

## Notes

- Ticket range changes never silently destroy data: if tickets already exist,
  re-initializing requires an explicit `force=true` confirmation.
- The monitor endpoint/page is intentionally public read-only; add
  authentication there if your deployment requires privacy.
- SQLite is used for the initial deployment; the settings layer is
  PostgreSQL-compatible via environment variables.
