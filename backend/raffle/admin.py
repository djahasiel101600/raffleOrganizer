from django.contrib import admin

from .models import RaffleSettings, Reservation, ReservationTicket, Ticket


@admin.register(RaffleSettings)
class RaffleSettingsAdmin(admin.ModelAdmin):
    list_display = ["raffle_name", "starting_ticket_number", "ending_ticket_number"]


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ["id", "number", "status", "updated_at"]
    list_filter = ["status"]
    search_fields = ["number"]


class ReservationTicketInline(admin.TabularInline):
    model = ReservationTicket
    extra = 0
    readonly_fields = ["ticket"]


@admin.register(Reservation)
class ReservationAdmin(admin.ModelAdmin):
    list_display = ["id", "display_id", "customer_name", "status", "created_at"]
    list_filter = ["status"]
    search_fields = ["customer_name", "contact_number"]
    inlines = [ReservationTicketInline]
