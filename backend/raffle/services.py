"""
Service layer for the raffle domain.

Reservation logic lives here (not in serializers/views) so that business
rules are enforced in one place. In particular:

- ``create_reservation`` wraps everything in a single database transaction and
  locks every requested ticket row with ``select_for_update``. Two
  administrators trying to reserve the same ticket at the same time therefore
  serialise: the first request commits, the second sees the ticket reserved
  and fails cleanly.
- On SQLite, ``select_for_update`` is a no-op and the platform uses a single
  writer lock, so a concurrent writer may raise ``OperationalError``.
  ``create_reservation`` retries the whole transaction a few times, which
  causes the loser to re-check availability and be rejected with a clear
  "already reserved" error. It is never double-reserved.
"""

import logging
import time

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import DatabaseError, transaction
from django.utils import timezone

from .constants import ReservationStatus, TicketStatus
from .models import RaffleSettings, Reservation, ReservationTicket, Ticket

logger = logging.getLogger(__name__)

RESERVATION_EVENT_GROUP = "reservations"
MAX_TRANSACTION_ATTEMPTS = 5


class ReservationError(Exception):
    """Raised when a reservation/cancellation cannot be performed.

    ``message`` is safe to show directly to the administrator.
    ``code`` is a stable machine-readable hint (e.g. "ticket_reserved").
    """

    def __init__(self, message: str, code: str = "reservation_error"):
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------
# Broadcasting
# ---------------------------------------------------------------------------


def broadcast_reservation_event(event: dict) -> None:
    """Send an event dict to every connected monitoring WebSocket."""
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    try:
        async_to_sync(channel_layer.group_send)(
            RESERVATION_EVENT_GROUP,
            {"type": "reservation.event", "data": event},
        )
    except Exception:  # pragma: no cover - never break a reservation on fan-out
        logger.exception("Failed to broadcast reservation event")


def _created_event(reservation: Reservation) -> dict:
    settings = RaffleSettings.get_singleton()
    padding = settings.ticket_number_padding
    numbers = list(
        reservation.ticket_links.select_related("ticket").values_list(
            "ticket__number", flat=True
        )
    )
    numbers.sort()
    return {
        "type": "reservation_created",
        "reservation_id": reservation.pk,
        "reservation_display_id": reservation.display_id,
        "customer_name": reservation.customer_name,
        "ticket_numbers": [str(n).zfill(padding) for n in numbers],
        "reserved_count": len(numbers),
        "reserved_at": reservation.created_at.isoformat(),
    }


def _cancelled_event(reservation: Reservation) -> dict:
    settings = RaffleSettings.get_singleton()
    padding = settings.ticket_number_padding
    numbers = list(
        reservation.ticket_links.select_related("ticket").values_list(
            "ticket__number", flat=True
        )
    )
    numbers.sort()
    return {
        "type": "reservation_cancelled",
        "reservation_id": reservation.pk,
        "reservation_display_id": reservation.display_id,
        "customer_name": reservation.customer_name,
        "ticket_numbers": [str(n).zfill(padding) for n in numbers],
    }


# ---------------------------------------------------------------------------
# Ticket initialization
# ---------------------------------------------------------------------------


def initialize_tickets(
    start: int,
    end: int,
    padding: int = 4,
    force: bool = False,
) -> dict:
    """Create ticket numbers for the range ``start..end`` (inclusive).

    When tickets already exist and ``force`` is False an error is raised: the
    caller must explicitly confirm that re-initialising (which deletes the
    existing raffle) is intended. Existing reservations are never silently
    destroyed.
    """
    start = int(start)
    end = int(end)
    padding = int(padding)

    if start < 1:
        raise ReservationError(
            "Starting ticket number must be at least 1.", code="invalid_range"
        )
    if end < start:
        raise ReservationError(
            "Ending ticket number must be greater than or equal to the starting number.",
            code="invalid_range",
        )
    if padding < 0 or padding > 12:
        raise ReservationError(
            "Ticket number padding must be between 0 and 12.", code="invalid_range"
        )

    total = end - start + 1
    if total > 200_000:
        raise ReservationError(
            "Ticket range is too large (maximum 200,000 tickets).",
            code="range_too_large",
        )

    existing_count = Ticket.objects.count()
    if existing_count and not force:
        raise ReservationError(
            "Tickets already exist. Re-initializing will delete all existing "
            "tickets and reservations. Send force=true to confirm.",
            code="tickets_exist",
        )

    with transaction.atomic():
        if existing_count:
            ReservationTicket.objects.all().delete()
            Reservation.objects.all().delete()
            Ticket.objects.all().delete()

        numbers = list(range(start, end + 1))
        tickets = [Ticket(number=n, status=TicketStatus.AVAILABLE) for n in numbers]
        Ticket.objects.bulk_create(tickets, batch_size=2000, ignore_conflicts=True)

        settings = RaffleSettings.get_singleton()
        settings.starting_ticket_number = start
        settings.ending_ticket_number = end
        settings.ticket_number_padding = padding
        settings.save()

    created = Ticket.objects.count()
    return {"created": created, "total": total, "start": start, "end": end}


# ---------------------------------------------------------------------------
# Reservation creation
# ---------------------------------------------------------------------------


def _validate_ticket_numbers(ticket_numbers) -> list[int]:
    if not ticket_numbers:
        raise ReservationError(
            "Select at least one ticket number.", code="empty_tickets"
        )

    try:
        numbers = [int(n) for n in ticket_numbers]
    except (TypeError, ValueError):
        raise ReservationError(
            "Ticket numbers must be whole numbers.", code="invalid_ticket"
        )

    for n in numbers:
        if n < 1:
            raise ReservationError(
                "Ticket numbers must be positive.", code="invalid_ticket"
            )

    duplicates = {n for n in numbers if numbers.count(n) > 1}
    if duplicates:
        dup = sorted(duplicates)[0]
        raise ReservationError(
            f"Duplicate ticket number {dup} was submitted more than once.",
            code="duplicate_ticket",
        )
    return sorted(set(numbers))


def _create_reservation_once(
    customer_name: str,
    contact_number: str,
    notes: str,
    ticket_numbers: list[int],
) -> Reservation:
    """One attempt at creating a reservation inside a single transaction."""
    numbers = _validate_ticket_numbers(ticket_numbers)

    with transaction.atomic():
        # Sentinel write: acquire the platform's write lock up front. On
        # SQLite the whole database has a single writer, so this serialises
        # all reservation transactions before any availability read happens
        # (select_for_update is a no-op there). On PostgreSQL this also
        # serialises reservation creation, keeping the logic easy to reason
        # about. Contention raises OperationalError, which the caller retries.
        RaffleSettings.objects.filter(pk=1).update(updated_at=timezone.now())

        # Lock the requested ticket rows (sorted to avoid deadlocks).
        tickets = list(
            Ticket.objects.select_for_update()
            .filter(number__in=numbers)
            .order_by("id")
        )

        found = {t.number for t in tickets}
        missing = [n for n in numbers if n not in found]
        if missing:
            raise ReservationError(
                f"Ticket {missing[0]} does not exist.", code="ticket_does_not_exist"
            )

        unavailable = [t.number for t in tickets if t.status != TicketStatus.AVAILABLE]
        if unavailable:
            raise ReservationError(
                f"Ticket {unavailable[0]} is already reserved.",
                code="ticket_reserved",
            )

        reservation = Reservation.objects.create(
            customer_name=customer_name,
            contact_number=contact_number,
            notes=notes,
            status=ReservationStatus.ACTIVE,
        )

        ReservationTicket.objects.bulk_create(
            [ReservationTicket(reservation=reservation, ticket=t) for t in tickets]
        )

        Ticket.objects.filter(number__in=numbers).update(
            status=TicketStatus.RESERVED, updated_at=timezone.now()
        )

        event = _created_event(reservation)
        transaction.on_commit(lambda: broadcast_reservation_event(event))

        reservation_id = reservation.pk
        customer = reservation.customer_name
        count = len(tickets)

    reservation = Reservation.objects.get(pk=reservation_id)
    logger.info("Reservation #%s: %d ticket(s) for %s", reservation_id, count, customer)
    return reservation


def create_reservation(
    customer_name: str,
    contact_number: str = "",
    ticket_numbers: list[int] | None = None,
    notes: str = "",
) -> Reservation:
    """Create a reservation atomically and broadcast a live event.

    Retries a bounded number of times if SQLite raises a transient
    ``OperationalError`` while two requests contend for the write lock. The
    loser of the race re-reads the tickets and fails with an explicit
    "already reserved" error — partial reservations never happen.
    """
    customer_name = (customer_name or "").strip()
    if not customer_name:
        raise ReservationError(
            "Customer name is required.", code="customer_name_required"
        )
    contact_number = (contact_number or "").strip()
    notes = (notes or "").strip()

    numbers = _validate_ticket_numbers(ticket_numbers)

    last_error: DatabaseError | None = None
    for attempt in range(1, MAX_TRANSACTION_ATTEMPTS + 1):
        try:
            return _create_reservation_once(
                customer_name, contact_number, notes, numbers
            )
        except DatabaseError as exc:  # pragma: no cover - SQLite writer contention
            last_error = exc
            if attempt == MAX_TRANSACTION_ATTEMPTS:
                break
            time.sleep(0.1 * attempt)
            logger.warning(
                "Database contention while reserving; retry %d/%d",
                attempt,
                MAX_TRANSACTION_ATTEMPTS,
            )

    raise ReservationError(
        "Temporarily unable to reserve tickets due to heavy load. "
        "Please try again.",
        code="database_busy",
    ) from last_error


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------


def cancel_reservation(reservation: Reservation) -> Reservation:
    """Cancel an active reservation and return its tickets to Available."""
    with transaction.atomic():
        # Lock the reservation row so two cancels cannot race.
        locked = Reservation.objects.select_for_update().get(pk=reservation.pk)
        if locked.status != ReservationStatus.ACTIVE:
            raise ReservationError(
                "This reservation is already cancelled.", code="already_cancelled"
            )

        now = timezone.now()
        locked.status = ReservationStatus.CANCELLED
        locked.cancelled_at = now
        locked.save(update_fields=["status", "cancelled_at", "updated_at"])

        ticket_ids = list(
            locked.ticket_links.select_related("ticket").values_list(
                "ticket_id", flat=True
            )
        )
        Ticket.objects.filter(id__in=ticket_ids).update(
            status=TicketStatus.AVAILABLE, updated_at=now
        )

        event = _cancelled_event(locked)
        transaction.on_commit(lambda: broadcast_reservation_event(event))

    locked.refresh_from_db()
    return locked


# ---------------------------------------------------------------------------
# Monitoring / dashboard queries
# ---------------------------------------------------------------------------


def monitor_stats() -> dict:
    settings = RaffleSettings.get_singleton()
    total = Ticket.objects.count()
    reserved = Ticket.objects.filter(status=TicketStatus.RESERVED).count()
    available = Ticket.objects.filter(status=TicketStatus.AVAILABLE).count()
    reservations = Reservation.objects.filter(
        status=ReservationStatus.ACTIVE
    ).count()
    return {
        "raffle_name": settings.raffle_name,
        "total_tickets": total,
        "reserved_tickets": reserved,
        "available_tickets": available,
        "reserved_percent": round((reserved / total * 100) if total else 0.0, 1),
        "total_reservations": reservations,
        "configured_total": settings.total_tickets,
    }