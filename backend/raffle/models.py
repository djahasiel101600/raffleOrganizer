import os
import uuid

from django.db import models
from django.db.models import CheckConstraint, Q, UniqueConstraint

from .constants import ReservationStatus, TicketStatus


def ticket_design_background_path(instance, filename: str) -> str:
    """Store uploaded ticket backgrounds under a stable, unique path."""
    ext = os.path.splitext(filename)[1].lower()
    return f"ticket_design/backgrounds/{uuid.uuid4().hex}{ext}"


class RaffleSettings(models.Model):
    """Singleton holding the raffle-wide configuration (one row, pk=1)."""

    raffle_name = models.CharField(max_length=200, default="Annual Community Raffle")
    starting_ticket_number = models.PositiveIntegerField(default=1)
    ending_ticket_number = models.PositiveIntegerField(default=1000)
    ticket_number_padding = models.PositiveIntegerField(default=4)
    default_tickets_per_column = models.PositiveIntegerField(default=3)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Raffle settings"
        verbose_name_plural = "Raffle settings"

    def __str__(self):
        return self.raffle_name

    def save(self, *args, **kwargs):
        self.pk = 1
        kwargs["force_insert"] = False
        super().save(*args, **kwargs)

    @classmethod
    def get_singleton(cls) -> "RaffleSettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def pad_number(self, number: int) -> str:
        return str(number).zfill(self.ticket_number_padding)

    @property
    def total_tickets(self) -> int:
        if self.ending_ticket_number < self.starting_ticket_number:
            return 0
        return self.ending_ticket_number - self.starting_ticket_number + 1


class Ticket(models.Model):
    """A single raffle ticket number."""

    number = models.PositiveIntegerField(unique=True, db_index=True)
    status = models.CharField(
        max_length=20,
        choices=TicketStatus.choices,
        default=TicketStatus.AVAILABLE,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["number"]
        constraints = [
            CheckConstraint(
                check=Q(status__in=[
                    TicketStatus.AVAILABLE,
                    TicketStatus.RESERVED,
                ]),
                name="ticket_status_valid",
            )
        ]

    def __str__(self):
        return f"Ticket {self.formatted_number()}"

    def formatted_number(self, padding: int | None = None) -> str:
        if padding is None:
            padding = RaffleSettings.get_singleton().ticket_number_padding
        return str(self.number).zfill(padding)


class Reservation(models.Model):
    """A customer reservation covering one or more tickets."""

    customer_name = models.CharField(max_length=200)
    contact_number = models.CharField(max_length=50, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=20,
        choices=ReservationStatus.choices,
        default=ReservationStatus.ACTIVE,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            CheckConstraint(
                check=Q(status__in=[
                    ReservationStatus.ACTIVE,
                    ReservationStatus.CANCELLED,
                ]),
                name="reservation_status_valid",
            )
        ]

    def __str__(self):
        return f"{self.display_id} — {self.customer_name}"

    @property
    def display_id(self) -> str:
        return f"R-{self.pk:06d}"


class ReservationTicket(models.Model):
    """Link between a reservation and its tickets."""

    reservation = models.ForeignKey(
        Reservation, on_delete=models.CASCADE, related_name="ticket_links"
    )
    ticket = models.ForeignKey(
        Ticket, on_delete=models.CASCADE, related_name="reservation_links"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["ticket__number"]
        constraints = [
            UniqueConstraint(
                fields=["ticket", "reservation"],
                name="unique_ticket_in_reservation",
            )
        ]

    def __str__(self):
        return f"{self.reservation} -> {self.ticket}"


class TicketDesign(models.Model):
    """Singleton holding the printable ticket template.

    The template is a background image (JPG/PNG designed to the exact ticket
    size guide) plus a JSON list of absolutely-positioned text elements.  It
    also stores the default print sheet setup (paper size, orientation,
    columns, rows, margin, gap) used by the print center.
    """

    background = models.FileField(
        upload_to=ticket_design_background_path, null=True, blank=True
    )
    layout = models.JSONField(default=list, blank=True)
    page_size = models.CharField(max_length=10, default="a4")
    page_orientation = models.CharField(max_length=10, default="portrait")
    page_columns = models.PositiveIntegerField(default=5)
    page_rows = models.PositiveIntegerField(default=3)
    margin_mm = models.PositiveIntegerField(default=10)
    gap_mm = models.PositiveIntegerField(default=4)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Ticket design"
        verbose_name_plural = "Ticket design"

    def __str__(self):
        return "Ticket design"

    def save(self, *args, **kwargs):
        self.pk = 1
        kwargs["force_insert"] = False
        super().save(*args, **kwargs)

    @classmethod
    def get_design(cls) -> "TicketDesign":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
