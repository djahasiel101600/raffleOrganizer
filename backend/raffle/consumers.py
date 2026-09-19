from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .services import RESERVATION_EVENT_GROUP


class ReservationConsumer(AsyncJsonWebsocketConsumer):
    """Broadcasts reservation created/cancelled events to monitor pages."""

    async def connect(self):
        await self.channel_layer.group_add(
            RESERVATION_EVENT_GROUP, self.channel_name
        )
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            RESERVATION_EVENT_GROUP, self.channel_name
        )

    async def reservation_event(self, event):
        await self.send_json(event["data"])