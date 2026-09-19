#!/bin/sh
# Container entrypoint for the raffle-ticket-api service.
# Prepares the database/static files, bootstraps the first admin and then
# hands over to daphne (ASGI + WebSockets) as PID 1.
set -e

echo "==> Applying database migrations"
python manage.py migrate --noinput

echo "==> Collecting static files (served by the raffle-ticket-web proxy)"
python manage.py collectstatic --noinput --clear

# Idempotent: skips silently when the account already exists.
if [ "${RAFFLE_BOOTSTRAP_ADMIN:-1}" = "1" ]; then
    echo "==> Ensuring the administrator account exists"
    python manage.py create_default_admin
fi

echo "==> Starting daphne on 0.0.0.0:8000"
exec daphne -b 0.0.0.0 -p 8000 config.asgi:application