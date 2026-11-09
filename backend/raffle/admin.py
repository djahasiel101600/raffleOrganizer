from django.contrib import admin

from .models import Payment, RaffleSettings, Reservation, ReservationTicket, Ticket


@admin.register(RaffleSettings)
class RaffleSettingsAdmin(admin.ModelAdmin):
    list_display = [
        "raffle_name",
        "starting_ticket_number",
        "ending_ticket_number",
        "ticket_price",
        "default_tickets_per_column",
    ]


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ["id", "number", "status", "updated_at"]
    list_filter = ["status"]
    search_fields = ["number"]


class ReservationTicketInline(admin.TabularInline):
    model = ReservationTicket
    extra = 0
    readonly_fields = ["ticket"]


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0
    readonly_fields = ["payment_date", "processed_by"]


@admin.register(Reservation)
class ReservationAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "display_id",
        "customer_name",
        "source",
        "status",
        "payment_status",
        "total_amount",
        "amount_paid",
        "balance_due",
        "created_at",
    ]
    list_filter = ["status", "payment_status", "source"]
    search_fields = ["customer_name", "contact_number", "display_id"]
    inlines = [ReservationTicketInline, PaymentInline]


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ["id", "reservation", "amount", "payment_date", "payment_method", "processed_by"]
    list_filter = ["payment_date", "payment_method"]
    search_fields = ["reservation__customer_name", "reservation__display_id"]
