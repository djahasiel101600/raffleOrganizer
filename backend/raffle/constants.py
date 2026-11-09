from django.db import models


class TicketStatus(models.TextChoices):
    AVAILABLE = "available", "Available"
    RESERVED = "reserved", "Reserved"


class ReservationStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    CANCELLED = "cancelled", "Cancelled"


class PaymentStatus(models.TextChoices):
    UNPAID = "unpaid", "Unpaid"
    PARTIALLY_PAID = "partially_paid", "Partially Paid"
    PAID = "paid", "Paid"
    CANCELLED = "cancelled", "Cancelled"


class ReservationSource(models.TextChoices):
    PUBLIC = "public", "Public"
    AUTHENTICATED = "authenticated", "Authenticated"