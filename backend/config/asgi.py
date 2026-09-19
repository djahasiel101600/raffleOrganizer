"""
ASGI config for the Raffle Ticket Reservation system.

Exposes the Channels application so that both the REST API and the
`/ws/reservations/` WebSocket endpoint are served by daphne.
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# Initialise Django before importing the routing module.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from config.middleware import TokenAuthMiddleware  # noqa: E402
from raffle.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": TokenAuthMiddleware(URLRouter(websocket_urlpatterns)),
    }
)
