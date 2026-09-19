"""
ASGI middleware that authenticates WebSocket connections using the token
passed as a query parameter (e.g. ?token=<access>).

The monitoring WebSocket is intentionally open to anonymous viewers, so an
unauthenticated connection is accepted but flagged. Admin clients may pass a
token to identify themselves; it is not currently required.
"""

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from rest_framework_simplejwt.tokens import AccessToken


class TokenAuthMiddleware(BaseMiddleware):
    """Attach `scope["user"]` when a valid JWT is supplied via query string."""

    async def __call__(self, scope, receive, send):
        query = parse_qs(scope.get("query_string", b"").decode())
        token = (query.get("token") or [None])[0]
        scope["user"] = await self._resolve_user(token)
        return await super().__call__(scope, receive, send)

    @database_sync_to_async
    def _resolve_user(self, token: str | None):
        from django.contrib.auth import get_user_model

        if not token:
            return None
        try:
            access = AccessToken(token)
            return get_user_model().objects.get(pk=access["user_id"])
        except Exception:
            return None