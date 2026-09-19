import base64
import json
import os
import shutil
import tempfile
import threading

from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from .constants import ReservationStatus, TicketStatus
from .models import RaffleSettings, Reservation, ReservationTicket, Ticket, TicketDesign
from .services import (
    ReservationError,
    cancel_reservation,
    create_reservation,
    initialize_tickets,
)


def bootstrap_raffle(start=1, end=100, padding=4, force=False):
    return initialize_tickets(start, end, padding, force=force)


class TicketGenerationTests(TestCase):
    def setUp(self):
        bootstrap_raffle(1, 100, 4)

    def test_generates_expected_count(self):
        self.assertEqual(Ticket.objects.count(), 100)

    def test_ticket_numbers_are_unique(self):
        numbers = list(Ticket.objects.values_list("number", flat=True))
        self.assertEqual(len(numbers), len(set(numbers)))

    def test_initial_status_is_available(self):
        self.assertEqual(
            Ticket.objects.filter(status=TicketStatus.AVAILABLE).count(), 100
        )
        self.assertEqual(Ticket.objects.filter(status=TicketStatus.RESERVED).count(), 0)

    def test_display_number_respects_padding(self):
        ticket = Ticket.objects.get(number=5)
        self.assertEqual(ticket.formatted_number(), "0005")

    def test_invalid_range_rejected(self):
        with self.assertRaises(ReservationError):
            bootstrap_raffle(10, 5, 4, force=True)
        with self.assertRaises(ReservationError):
            bootstrap_raffle(0, 50, 4, force=True)

    def test_force_regeneration_warns(self):
        # Existing tickets require an explicit force.
        with self.assertRaises(ReservationError) as ctx:
            initialize_tickets(1, 200, 4, force=False)
        self.assertEqual(ctx.exception.code, "tickets_exist")


class ReservationServiceTests(TestCase):
    def setUp(self):
        bootstrap_raffle(1, 100, 4)

    def test_single_ticket_reservation(self):
        reservation = create_reservation("Juan Dela Cruz", "09123456789", [10])
        self.assertEqual(reservation.status, ReservationStatus.ACTIVE)
        self.assertEqual(reservation.customer_name, "Juan Dela Cruz")
        self.assertEqual(reservation.ticket_links.count(), 1)
        self.assertEqual(
            Ticket.objects.get(number=10).status, TicketStatus.RESERVED
        )

    def test_multiple_ticket_reservation(self):
        reservation = create_reservation("Maria Santos", "09170000000", [1, 2, 3, 4, 5])
        self.assertEqual(reservation.ticket_links.count(), 5)
        reserved = set(
            Ticket.objects.filter(status=TicketStatus.RESERVED).values_list(
                "number", flat=True
            )
        )
        self.assertEqual(reserved, {1, 2, 3, 4, 5})

    def test_customer_name_required(self):
        with self.assertRaises(ReservationError) as ctx:
            create_reservation("   ", "0912", [1])
        self.assertEqual(ctx.exception.code, "customer_name_required")

    def test_empty_selection_rejected(self):
        with self.assertRaises(ReservationError) as ctx:
            create_reservation("Ana", "0912", [])
        self.assertEqual(ctx.exception.code, "empty_tickets")

    def test_invalid_ticket_rejected(self):
        with self.assertRaises(ReservationError) as ctx:
            create_reservation("Ana", "0912", [9999])
        self.assertEqual(ctx.exception.code, "ticket_does_not_exist")
        self.assertIn("9999", ctx.exception.message)

    def test_duplicate_request_numbers_rejected(self):
        with self.assertRaises(ReservationError) as ctx:
            create_reservation("Ana", "0912", [5, 5])
        self.assertEqual(ctx.exception.code, "duplicate_ticket")

    def test_already_reserved_ticket_rejected(self):
        create_reservation("First Customer", "0912", [25])
        with self.assertRaises(ReservationError) as ctx:
            create_reservation("Second Customer", "0913", [25])
        self.assertEqual(ctx.exception.code, "ticket_reserved")
        self.assertIn("25", ctx.exception.message)

    def test_reservation_is_all_or_nothing(self):
        # 30 is already reserved; the request also wants 31 and 32.
        create_reservation("Owner", "0912", [30])
        with self.assertRaises(ReservationError):
            create_reservation("New", "0913", [30, 31, 32])
        # Nothing extra should have been reserved.
        reserved = set(
            Ticket.objects.filter(status=TicketStatus.RESERVED).values_list(
                "number", flat=True
            )
        )
        self.assertEqual(reserved, {30})
        self.assertEqual(Reservation.objects.count(), 1)

    def test_cancellation_returns_tickets_to_available(self):
        reservation = create_reservation("Pedro", "0914", [40, 41, 42])
        cancelled = cancel_reservation(reservation)
        self.assertEqual(cancelled.status, ReservationStatus.CANCELLED)
        self.assertIsNotNone(cancelled.cancelled_at)
        for n in (40, 41, 42):
            self.assertEqual(
                Ticket.objects.get(number=n).status, TicketStatus.AVAILABLE
            )
        # The same tickets can be reserved again.
        create_reservation("Second", "0915", [40])

    def test_cancel_twice_rejected(self):
        reservation = create_reservation("Pedro", "0914", [43])
        cancel_reservation(reservation)
        with self.assertRaises(ReservationError) as ctx:
            cancel_reservation(reservation)
        self.assertEqual(ctx.exception.code, "already_cancelled")


class ConcurrencyTests(TransactionTestCase):
    """Verify two simultaneous reservations cannot reserve the same ticket."""

    def setUp(self):
        bootstrap_raffle(1, 200, 4)

    def test_concurrent_same_ticket_only_one_wins(self):
        results: list = []
        errors: list = []
        barrier = threading.Barrier(2)

        def attempt(customer: str, ticket: int):
            barrier.wait(timeout=10)
            try:
                results.append(create_reservation(customer, "0912", [ticket]))
            except Exception as exc:  # noqa: BLE001 - collected for assertions
                errors.append(exc)

        threads = [
            threading.Thread(target=attempt, args=("Admin A", 150)),
            threading.Thread(target=attempt, args=("Admin B", 150)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)

        self.assertEqual(len(results), 1, "exactly one reservation must win")
        self.assertEqual(len(errors), 1, "the other attempt must be rejected")
        self.assertIsInstance(errors[0], ReservationError)

        # Exactly one ReservationTicket row references ticket 150.
        self.assertEqual(
            ReservationTicket.objects.filter(ticket__number=150).count(), 1
        )
        self.assertEqual(
            Ticket.objects.get(number=150).status, TicketStatus.RESERVED
        )
        self.assertEqual(Reservation.objects.count(), 1)


class ReservationApiTests(APITestCase):
    def setUp(self):
        bootstrap_raffle(1, 60, 4)
        self.user = get_user_model().objects.create_user(
            username="teller", password="secret-pass-123"
        )
        self.client = APIClient()

        login = self.client.post(
            "/api/auth/login/",
            {"username": "teller", "password": "secret-pass-123"},
            format="json",
        )
        self.assertEqual(login.status_code, status.HTTP_200_OK)
        self.token = login.data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")

    def test_login_required_for_dashboard(self):
        client = APIClient()
        response = client.get("/api/dashboard/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_dashboard_stats(self):
        response = self.client.get("/api/dashboard/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["total_tickets"], 60)
        self.assertEqual(response.data["reserved_tickets"], 0)

    def test_ticket_list_and_filters(self):
        create_reservation("Owner", "0912", [7])
        response = self.client.get("/api/tickets/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 60)

        response = self.client.get("/api/tickets/?status=reserved")
        self.assertEqual(response.data["count"], 1)

        response = self.client.get("/api/tickets/?search=7")
        numbers = [t["number"] for t in response.data["results"]]
        self.assertIn(7, numbers)
        self.assertTrue(all("7" in str(n) for n in numbers))

    def test_create_reservation_via_api(self):
        response = self.client.post(
            "/api/reservations/",
            {
                "customer_name": "Juan Dela Cruz",
                "contact_number": "09123456789",
                "ticket_numbers": [10, 11, 12],
                "notes": "Church member",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(len(response.data["ticket_numbers"]), 3)
        self.assertEqual(response.data["ticket_numbers"], ["0010", "0011", "0012"])
        self.assertEqual(
            Ticket.objects.filter(status=TicketStatus.RESERVED).count(), 3
        )

    def test_api_rejects_already_reserved(self):
        create_reservation("Owner", "0912", [5])
        response = self.client.post(
            "/api/reservations/",
            {"customer_name": "New", "ticket_numbers": [5, 6]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "ticket_reserved")
        # No partial reservation was created for ticket 6.
        self.assertEqual(
            Ticket.objects.filter(status=TicketStatus.RESERVED).count(), 1
        )

    def test_api_shows_clear_validation_message(self):
        response = self.client.post(
            "/api/reservations/",
            {"customer_name": "New", "ticket_numbers": []},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "empty_tickets")

    def test_cancel_via_api_returns_tickets(self):
        created = create_reservation("Owner", "0912", [20, 21])
        response = self.client.post(f"/api/reservations/{created.pk}/cancel/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], ReservationStatus.CANCELLED)
        self.assertEqual(
            Ticket.objects.filter(status=TicketStatus.AVAILABLE, number__in=[20, 21])
            .count(),
            2,
        )

    def test_search_reservations_by_customer_and_ticket(self):
        create_reservation("Juan Dela Cruz", "09123456789", [1])
        create_reservation("Maria Santos", "09223334444", [2, 3])

        response = self.client.get("/api/reservations/?search=juan")
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["customer_name"], "Juan Dela Cruz")

        response = self.client.get("/api/reservations/?ticket=3")
        self.assertEqual(response.data["count"], 1)

    def test_monitor_is_public_read_only(self):
        create_reservation("Maria", "0911", [55])
        client = APIClient()  # no credentials
        response = client.get("/api/monitor/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["reserved_tickets"], 1)
        self.assertEqual(len(response.data["recent_reservations"]), 1)

    def test_settings_requires_auth(self):
        client = APIClient()
        response = client.get("/api/settings/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class ReservationWebSocketTests(TransactionTestCase):
    async def test_consumer_receives_broadcast(self):
        from channels.layers import get_channel_layer

        from config.asgi import application  # noqa: F401

        communicator = WebsocketCommunicator(application, "/ws/reservations/")
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        event = {
            "type": "reservation_created",
            "reservation_id": 1,
            "reservation_display_id": "R-000001",
            "customer_name": "Test Customer",
            "ticket_numbers": ["0001", "0002"],
            "reserved_count": 2,
            "reserved_at": "2026-09-06T20:30:00+08:00",
        }
        await get_channel_layer().group_send(
            "reservations",
            {"type": "reservation.event", "data": event},
        )

        response = await communicator.receive_json_from(timeout=2)
        self.assertEqual(response["type"], "reservation_created")
        self.assertEqual(response["customer_name"], "Test Customer")

        await communicator.disconnect()


class TicketGeometryTests(TestCase):
    def test_a4_portrait_5x3_ticket_size(self):
        from .ticket_geometry import compute_ticket_size_mm

        width, height = compute_ticket_size_mm("A4", "portrait", 5, 3, 10, 4)
        # (210 - 2*10 - 4*4) / 5  x  (297 - 2*10 - 2*4) / 3
        self.assertAlmostEqual(width, (210 - 20 - 16) / 5)
        self.assertAlmostEqual(height, (297 - 20 - 8) / 3)

    def test_landscape_swaps_dimensions(self):
        from .ticket_geometry import page_dimensions_mm

        width, height = page_dimensions_mm("A4", "landscape")
        self.assertAlmostEqual(width, 297.0)
        self.assertAlmostEqual(height, 210.0)

    def test_impossible_setup_rejected(self):
        from .ticket_geometry import GeometryError, compute_ticket_size_mm

        with self.assertRaises(GeometryError):
            compute_ticket_size_mm("A4", "portrait", 10, 1, 150, 0)

    def test_paginate_keeps_partial_last_sheet(self):
        from .ticket_geometry import paginate_ticket_numbers, tickets_per_page

        numbers = [f"{n:04d}" for n in range(1, 4)]  # 3 tickets
        pages = paginate_ticket_numbers(numbers, tickets_per_page(5, 3))
        self.assertEqual(len(pages), 1)
        self.assertEqual(pages[0], ["0001", "0002", "0003"])

    def test_paginate_multiple_sheets(self):
        from .ticket_geometry import paginate_ticket_numbers

        numbers = [str(n) for n in range(1, 18)]  # 17 tickets
        pages = paginate_ticket_numbers(numbers, 15)
        self.assertEqual(len(pages), 2)
        self.assertEqual(len(pages[0]), 15)
        self.assertEqual(len(pages[1]), 2)

    def test_layout_validation_cleans_and_rejects(self):
        from .ticket_geometry import GeometryError, validate_design_layout

        layout = [
            {
                "id": "a",
                "text": "{number}",
                "x": 10,
                "y": 5,
                "fontSize": 8,
                "bold": True,
                "color": "#FF0000",
                "align": "center",
            }
        ]
        cleaned = validate_design_layout(layout)
        self.assertEqual(cleaned[0]["text"], "{number}")
        self.assertTrue(cleaned[0]["bold"])
        self.assertEqual(cleaned[0]["color"], "#ff0000")

        with self.assertRaises(GeometryError):
            validate_design_layout(
                [{"text": "x", "x": 999, "y": 0, "fontSize": 8}]
            )
        with self.assertRaises(GeometryError):
            validate_design_layout(
                [{"text": "x", "x": 1, "y": 1, "fontSize": 0}]
            )
        with self.assertRaises(GeometryError):
            validate_design_layout(
                [{"text": "x", "x": 1, "y": 1, "fontSize": 8}, "not-an-object"]
            )

    def test_layout_validation_shapes_and_rotation(self):
        from .ticket_geometry import GeometryError, validate_design_layout

        cleaned = validate_design_layout(
            [
                {
                    "id": "t",
                    "type": "text",
                    "text": "{number}",
                    "x": 50,
                    "y": 20,
                    "rotation": -15,
                    "fontSize": 8,
                },
                {
                    "id": "s",
                    "type": "shape",
                    "shape": "ellipse",
                    "x": 50,
                    "y": 80,
                    "rotation": 45,
                    "width": 40,
                    "height": 10,
                    "fill": "#FF8800",
                    "strokeColor": "bogus",
                    "strokeWidth": 2,
                },
            ]
        )
        self.assertEqual(cleaned[0]["type"], "text")
        self.assertEqual(cleaned[0]["rotation"], -15.0)
        self.assertEqual(cleaned[1]["type"], "shape")
        self.assertEqual(cleaned[1]["shape"], "ellipse")
        self.assertEqual(cleaned[1]["fill"], "#ff8800")
        self.assertEqual(cleaned[1]["strokeColor"], "#1e3a8a")  # fallback

        # Rotation bounds.
        with self.assertRaises(GeometryError):
            validate_design_layout(
                [{"text": "x", "x": 1, "y": 1, "fontSize": 8, "rotation": 200}]
            )
        # Unknown shape kind.
        with self.assertRaises(GeometryError):
            validate_design_layout(
                [{"type": "shape", "shape": "triangle", "x": 1, "y": 1}]
            )
        # Out-of-range shape size.
        with self.assertRaises(GeometryError):
            validate_design_layout(
                [{"type": "shape", "x": 1, "y": 1, "width": 0}]
            )
        # Legacy payloads without a type stay text elements.
        legacy = validate_design_layout([{"text": "hi", "x": 1, "y": 2}])
        self.assertEqual(legacy[0]["type"], "text")


class TicketDesignApiTests(APITestCase):
    def setUp(self):
        bootstrap_raffle(1, 60, 4)
        self.user = get_user_model().objects.create_user(
            username="teller", password="secret-pass-123"
        )
        self.client = APIClient()
        login = self.client.post(
            "/api/auth/login/",
            {"username": "teller", "password": "secret-pass-123"},
            format="json",
        )
        self.token = login.data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")

    def test_get_default_design(self):
        response = self.client.get("/api/ticket-design/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["page_columns"], 5)
        self.assertEqual(response.data["page_rows"], 3)
        self.assertEqual(response.data["layout"], [])
        self.assertGreater(float(response.data["ticket_width_mm"]), 0)

    def test_authentication_required(self):
        client = APIClient()
        response = client.get("/api/ticket-design/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_update_layout_and_sheet(self):
        payload = {
            "layout": [
                {
                    "id": "el-1",
                    "text": "{number}",
                    "x": 5,
                    "y": 30,
                    "fontSize": 10,
                    "bold": True,
                    "italic": False,
                    "underline": False,
                    "uppercase": False,
                    "align": "center",
                    "color": "#111111",
                    "fontFamily": "Arial",
                    "lineHeight": 1.2,
                }
            ],
            "page_size": "A4",
            "page_orientation": "portrait",
            "page_columns": 5,
            "page_rows": 3,
            "margin_mm": 10,
            "gap_mm": 4,
        }
        response = self.client.put("/api/ticket-design/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["layout"][0]["text"], "{number}")
        self.assertEqual(response.data["page_columns"], 5)
        # A4 portrait, 5 cols x 3 rows, 10 mm margin, 4 mm gap:
        # width (210-20-16)/5 = 34.8 mm, height (297-20-8)/3 ~= 89.67 mm.
        self.assertAlmostEqual(float(response.data["ticket_width_mm"]), 34.8, places=1)
        self.assertAlmostEqual(
            float(response.data["ticket_height_mm"]), 89.67, places=1
        )

    def test_impossible_sheet_rejected(self):
        response = self.client.put(
            "/api/ticket-design/",
            {"page_size": "A4", "page_orientation": "portrait", "margin_mm": 150},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_element_outside_ticket_rejected(self):
        response = self.client.put(
            "/api/ticket-design/",
            {"layout": [{"text": "x", "x": 500, "y": 500, "fontSize": 8}]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_shapes_and_rotation_round_trip(self):
        """A designer payload with shapes + rotated text survives a save/load."""
        payload = {
            "layout": [
                {
                    "id": "t-1",
                    "type": "text",
                    "text": "{customer}",
                    "x": 50,
                    "y": 25,
                    "rotation": -15,
                    "fontSize": 6,
                    "color": "#111827",
                },
                {
                    "id": "s-1",
                    "type": "shape",
                    "shape": "rectangle",
                    "x": 50,
                    "y": 70,
                    "rotation": 45,
                    "width": 30,
                    "height": 12,
                    "fill": "#ff8800",
                    "strokeColor": "#003366",
                    "strokeWidth": 2,
                },
            ]
        }
        response = self.client.put("/api/ticket-design/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        stored = self.client.get("/api/ticket-design/").data["layout"]
        self.assertEqual(stored[0]["type"], "text")
        self.assertEqual(stored[0]["rotation"], -15.0)
        self.assertEqual(stored[1]["type"], "shape")
        self.assertEqual(stored[1]["shape"], "rectangle")
        self.assertEqual(stored[1]["fill"], "#ff8800")
        self.assertEqual(stored[1]["strokeWidth"], 2.0)
        self.assertEqual(stored[1]["width"], 30.0)
        self.assertEqual(stored[1]["height"], 12.0)

    def test_multipart_save_keeps_rotation_and_type(self):
        """The designer saves via multipart/form-data — rotation must survive.

        Regression: a server process running pre-rotation code silently
        stripped ``type``/``rotation`` from the multipart layout JSON, so
        rotated elements snapped back on reload.
        """
        payload = {
            "layout": json.dumps(
                [
                    {
                        "id": "el-x",
                        "type": "text",
                        "text": "{customer}",
                        "x": 50,
                        "y": 40,
                        "rotation": -90,
                        "fontSize": 6,
                    },
                    {
                        "id": "el-s",
                        "type": "shape",
                        "shape": "rectangle",
                        "x": 50,
                        "y": 80,
                        "rotation": 45,
                        "width": 40,
                        "height": 10,
                        "fill": "#2563eb",
                    },
                ]
            ),
            "page_size": "a4",
            "page_orientation": "portrait",
            "page_columns": 5,
            "page_rows": 3,
            "margin_mm": 10,
            "gap_mm": 4,
        }
        response = self.client.put(
            "/api/ticket-design/", payload, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        saved_text = response.data["layout"][0]
        self.assertEqual(saved_text["rotation"], -90.0)
        self.assertEqual(saved_text["type"], "text")
        saved_shape = response.data["layout"][1]
        self.assertEqual(saved_shape["rotation"], 45.0)
        self.assertEqual(saved_shape["type"], "shape")

        # And it round-trips through a fresh load, like a page reload does.
        stored = self.client.get("/api/ticket-design/").data["layout"]
        self.assertEqual(stored[0]["rotation"], -90.0)
        self.assertEqual(stored[1]["rotation"], 45.0)

    def test_design_updates_persist(self):
        response = self.client.put(
            "/api/ticket-design/",
            {"page_columns": 4, "page_rows": 4, "gap_mm": 2},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response = self.client.get("/api/ticket-design/")
        self.assertEqual(response.data["page_columns"], 4)
        self.assertEqual(response.data["page_rows"], 4)
        self.assertEqual(response.data["gap_mm"], 2)


TEST_MEDIA_ROOT = tempfile.mkdtemp(prefix="raffle-test-media-")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class TicketBackgroundTests(APITestCase):
    """The designer uploads the ticket background as multipart/form-data.

    Uploads are isolated in a temporary MEDIA_ROOT so the test run never
    touches the development ``backend/media`` directory.
    """

    # A valid 1x1 transparent PNG, so no Pillow dependency is required.
    PNG_BASE64 = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8Dw"
        "HwAFAAH/q842iQAAAABJRU5ErkJggg=="
    )

    def setUp(self):
        bootstrap_raffle(1, 60, 4)
        self.user = get_user_model().objects.create_user(
            username="designer", password="secret-pass-123"
        )
        self.client = APIClient()
        login = self.client.post(
            "/api/auth/login/",
            {"username": "designer", "password": "secret-pass-123"},
            format="json",
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TEST_MEDIA_ROOT, ignore_errors=True)
        super().tearDownClass()

    def _png(self, name: str = "background.png") -> SimpleUploadedFile:
        return SimpleUploadedFile(
            name, base64.b64decode(self.PNG_BASE64), content_type="image/png"
        )

    def _layout(self) -> list[dict]:
        return [
            {
                "id": "el-1",
                "text": "{number}",
                "x": 50,
                "y": 50,
                "fontSize": 12,
                "bold": True,
            }
        ]

    def _multipart_payload(self, **overrides):
        payload = {
            "layout": json.dumps(self._layout()),
            "page_size": "a4",
            "page_orientation": "portrait",
            "page_columns": 5,
            "page_rows": 3,
            "margin_mm": 10,
            "gap_mm": 4,
        }
        payload.update(overrides)
        return payload

    def test_upload_background_saves_file(self):
        response = self.client.put(
            "/api/ticket-design/",
            self._multipart_payload(background=self._png()),
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertIsNotNone(response.data["background_url"])
        self.assertIn("/media/", response.data["background_url"])
        # The layout JSON string sent by the browser must be parsed.
        self.assertEqual(response.data["layout"][0]["text"], "{number}")

        design = TicketDesign.get_design()
        self.assertTrue(design.background)
        self.assertTrue(os.path.exists(design.background.path))

    def test_background_url_is_root_relative(self):
        """Root-relative so the frontend dev server / reverse proxy serves the
        file from the backend host on the same origin."""
        response = self.client.put(
            "/api/ticket-design/",
            self._multipart_payload(background=self._png()),
            format="multipart",
        )
        url = response.data["background_url"]
        self.assertTrue(
            url.startswith("/media/"),
            f"background_url must be root-relative for the /media proxy, got: {url}",
        )

    def test_get_returns_background_url_for_printing(self):
        """The print center reads the design via GET and must get the URL."""
        self.client.put(
            "/api/ticket-design/",
            self._multipart_payload(background=self._png()),
            format="multipart",
        )
        response = self.client.get("/api/ticket-design/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            str(response.data["background_url"]).startswith("/media/"),
            f"GET must expose the background URL, got: {response.data['background_url']}",
        )

    def test_replaced_background_file_is_removed(self):
        """Uploading a new image must not leave the old file orphaned on disk."""
        self.client.put(
            "/api/ticket-design/",
            self._multipart_payload(background=self._png("first.png")),
            format="multipart",
        )
        old_path = TicketDesign.get_design().background.path

        response = self.client.put(
            "/api/ticket-design/",
            self._multipart_payload(background=self._png("second.png")),
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertFalse(os.path.exists(old_path))
        self.assertTrue(os.path.exists(TicketDesign.get_design().background.path))

    def test_layout_only_update_keeps_background(self):
        self.client.put(
            "/api/ticket-design/",
            self._multipart_payload(background=self._png()),
            format="multipart",
        )
        stored_name = TicketDesign.get_design().background.name

        # Subsequent saves send no file — the image must survive.
        response = self.client.put(
            "/api/ticket-design/",
            self._multipart_payload(page_columns=4),
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertIsNotNone(response.data["background_url"])
        design = TicketDesign.get_design()
        self.assertEqual(design.background.name, stored_name)
        self.assertTrue(os.path.exists(design.background.path))

    def test_clear_background_removes_file(self):
        self.client.put(
            "/api/ticket-design/",
            self._multipart_payload(background=self._png()),
            format="multipart",
        )
        stored_path = TicketDesign.get_design().background.path

        response = self.client.put(
            "/api/ticket-design/",
            self._multipart_payload(clear_background="true"),
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertIsNone(response.data["background_url"])
        self.assertFalse(TicketDesign.get_design().background)
        self.assertFalse(os.path.exists(stored_path))

    def test_rejects_non_image_upload(self):
        not_an_image = SimpleUploadedFile(
            "notes.txt", b"hello", content_type="text/plain"
        )
        response = self.client.put(
            "/api/ticket-design/",
            self._multipart_payload(background=not_an_image),
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.data)
