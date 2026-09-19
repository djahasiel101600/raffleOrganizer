from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .constants import ReservationStatus, TicketStatus
from .models import RaffleSettings, Reservation, Ticket, TicketDesign
from .serializers import (
    MonitorRecentSerializer,
    RaffleSettingsSerializer,
    ReservationCreateSerializer,
    ReservationListSerializer,
    ReservationSerializer,
    TicketDesignSerializer,
    TicketSerializer,
)
from .services import (
    ReservationError,
    cancel_reservation,
    initialize_tickets,
    monitor_stats,
)


def _hydrate_numbers(reservations: list[Reservation]) -> None:
    """Precompute formatted ticket numbers from the prefetch cache.

    Two lists are attached to each reservation:

    ``_prefetched_numbers``
        Every number the reservation historically covers (used for history,
        including cancelled reservations).
    ``_printable_numbers``
        Only the tickets that are *active right now*: the reservation must be
        active **and** each ticket must still carry the ``reserved`` status.
        The Print Center prints from this list exclusively, so released or
        cancelled tickets can never end up on a sheet.
    """
    padding = RaffleSettings.get_singleton().ticket_number_padding
    for r in reservations:
        cache = getattr(r, "_prefetched_objects_cache", None)
        if cache is not None:
            links = list(cache.get("ticket_links", []))
            numbers = sorted(link.ticket.number for link in links)
            printable = sorted(
                link.ticket.number
                for link in links
                if link.ticket.status == TicketStatus.RESERVED
            )
        else:
            numbers = sorted(
                r.ticket_links.select_related("ticket").values_list(
                    "ticket__number", flat=True
                )
            )
            printable = sorted(
                r.ticket_links.select_related("ticket")
                .filter(ticket__status=TicketStatus.RESERVED)
                .values_list("ticket__number", flat=True)
            )
        r._prefetched_numbers = [str(n).zfill(padding) for n in numbers]
        if r.status != ReservationStatus.ACTIVE:
            printable = []
        r._printable_numbers = [str(n).zfill(padding) for n in printable]


def _recent_ids(limit: int = 30) -> list[int]:
    return list(
        Reservation.objects.filter(status=ReservationStatus.ACTIVE)
        .order_by("-created_at")
        .values_list("id", flat=True)[:limit]
    )


def _recent_ordered(ids: list[int]) -> list[Reservation]:
    rows = list(
        Reservation.objects.filter(id__in=ids).prefetch_related("ticket_links__ticket")
    )
    by_id = {r.id: r for r in rows}
    ordered = [by_id[i] for i in ids if i in by_id]
    _hydrate_numbers(ordered)
    return ordered


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


class DashboardView(APIView):
    """Aggregate ticket/reservation statistics plus recent reservations."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        stats = monitor_stats()
        recent = _recent_ordered(_recent_ids(limit=10))
        return Response(
            {
                **stats,
                "recent_reservations": MonitorRecentSerializer(
                    recent, many=True
                ).data,
            }
        )


# ---------------------------------------------------------------------------
# Tickets
# ---------------------------------------------------------------------------


class TicketListView(generics.ListAPIView):
    serializer_class = TicketSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Ticket.objects.all()
        status_filter = self.request.query_params.get("status")
        if status_filter in (TicketStatus.AVAILABLE, TicketStatus.RESERVED):
            queryset = queryset.filter(status=status_filter)

        search = self.request.query_params.get("search", "").strip()
        if search and search.isdigit():
            queryset = queryset.filter(number__contains=int(search))

        page_size = self.request.query_params.get("page_size", "100")
        try:
            page_size = max(1, min(int(page_size), 500))
        except ValueError:
            page_size = 100
        self.paginator.page_size = page_size
        return queryset


# ---------------------------------------------------------------------------
# Reservations
# ---------------------------------------------------------------------------


class ReservationListCreateView(generics.ListCreateAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.request.method == "POST":
            return ReservationCreateSerializer
        return ReservationListSerializer

    def get_queryset(self):
        queryset = Reservation.objects.all().prefetch_related("ticket_links__ticket")
        status_filter = self.request.query_params.get("status")
        if status_filter in (ReservationStatus.ACTIVE, ReservationStatus.CANCELLED):
            queryset = queryset.filter(status=status_filter)

        search = self.request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(customer_name__icontains=search)
                | Q(contact_number__icontains=search)
            )

        ticket = self.request.query_params.get("ticket", "").strip()
        if ticket and ticket.isdigit():
            queryset = queryset.filter(
                ticket_links__ticket__number=int(ticket)
            ).distinct()

        return queryset.order_by("-created_at")

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        if page is not None:
            _hydrate_numbers(list(page))
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        rows = list(queryset)
        _hydrate_numbers(rows)
        serializer = self.get_serializer(rows, many=True)
        return Response(serializer.data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reservation = serializer.save()
        _hydrate_numbers([reservation])
        return Response(
            ReservationSerializer(reservation).data,
            status=status.HTTP_201_CREATED,
        )


class ReservationDetailView(generics.RetrieveAPIView):
    queryset = Reservation.objects.all()
    serializer_class = ReservationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        _hydrate_numbers([instance])
        serializer = self.get_serializer(instance)
        return Response(serializer.data)


class ReservationCancelView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        reservation = get_object_or_404(Reservation, pk=pk)
        try:
            cancelled = cancel_reservation(reservation)
        except ReservationError as exc:
            return Response(
                {"detail": exc.message, "code": exc.code},
                status=status.HTTP_400_BAD_REQUEST,
            )
        _hydrate_numbers([cancelled])
        return Response(ReservationSerializer(cancelled).data)


# ---------------------------------------------------------------------------
# Monitoring (read-only, optionally public)
# ---------------------------------------------------------------------------


class MonitorView(APIView):
    def get_permissions(self):
        from django.conf import settings

        if getattr(settings, "PUBLIC_MONITOR", True):
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def get(self, request):
        stats = monitor_stats()
        recent = _recent_ordered(_recent_ids(limit=30))
        return Response(
            {
                **stats,
                "recent_reservations": MonitorRecentSerializer(
                    recent, many=True
                ).data,
            }
        )


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


class SettingsView(generics.RetrieveUpdateAPIView):
    serializer_class = RaffleSettingsSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return RaffleSettings.get_singleton()


class TicketDesignView(generics.RetrieveUpdateAPIView):
    """Read/update the printable ticket template (background + layout).

    ``PUT`` accepts either JSON or ``multipart/form-data``.  Multipart is used
    by the designer to upload the ticket background image together with the
    layout JSON.  ``clear_background=true`` removes the stored image.
    """

    serializer_class = TicketDesignSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return TicketDesign.get_design()

    def perform_update(self, serializer):
        request = self.request
        instance = serializer.instance
        previous_name = instance.background.name if instance.background else None
        design = serializer.save()

        # A replaced upload leaves the previous file on disk; remove it.  The
        # old FieldFile is bound to the live instance, so delete at the storage
        # level — FieldFile.delete() would also null the instance attribute and
        # the response would claim no background even though the new image was
        # saved correctly.
        if previous_name and (
            not design.background or design.background.name != previous_name
        ):
            storage = (
                design.background.storage
                if design.background
                else instance.background.storage
            )
            storage.delete(previous_name)

        clear = "background" not in request.FILES and str(
            request.data.get("clear_background", "")
        ).lower() in ("1", "true", "yes")
        if clear and design.background:
            design.background.delete(save=False)
            design.background = None
            design.save(update_fields=["background", "updated_at"])


class InitializeTicketsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        start = request.data.get("start")
        end = request.data.get("end")
        padding = request.data.get("padding", 4)
        force = bool(request.data.get("force", False))
        try:
            result = initialize_tickets(
                start=start, end=end, padding=padding, force=force
            )
        except ReservationError as exc:
            return Response(
                {"detail": exc.message, "code": exc.code},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(result, status=status.HTTP_201_CREATED)
