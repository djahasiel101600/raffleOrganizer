from rest_framework import serializers

from .constants import ReservationStatus, TicketStatus
from .models import RaffleSettings, Reservation, Ticket, TicketDesign
from .services import ReservationError, create_reservation
from .ticket_geometry import (
    ORIENTATIONS,
    GeometryError,
    PAPER_SIZES_MM,
    compute_ticket_size_mm,
    size_guide_mm_to_px,
    validate_design_layout,
)


def _padding() -> int:
    return RaffleSettings.get_singleton().ticket_number_padding


def _display(number: int) -> str:
    return str(number).zfill(_padding())


class RaffleSettingsSerializer(serializers.ModelSerializer):
    tickets_exist = serializers.SerializerMethodField()
    ticket_count = serializers.SerializerMethodField()

    class Meta:
        model = RaffleSettings
        fields = [
            "id",
            "raffle_name",
            "starting_ticket_number",
            "ending_ticket_number",
            "ticket_number_padding",
            "default_tickets_per_column",
            "tickets_exist",
            "ticket_count",
            "updated_at",
        ]

    def get_tickets_exist(self, obj):
        return Ticket.objects.exists()

    def get_ticket_count(self, obj):
        return Ticket.objects.count()


class TicketSerializer(serializers.ModelSerializer):
    display_number = serializers.SerializerMethodField()

    class Meta:
        model = Ticket
        fields = ["id", "number", "display_number", "status", "updated_at"]
        read_only_fields = ["id", "display_number", "status", "updated_at"]

    def get_display_number(self, obj):
        return obj.formatted_number()


class ReservationTicketNumberField(serializers.ListField):
    child = serializers.IntegerField(min_value=1)


class ReservationCreateSerializer(serializers.Serializer):
    customer_name = serializers.CharField(max_length=200, allow_blank=False)
    contact_number = serializers.CharField(
        required=False, allow_blank=True, max_length=50, default=""
    )
    notes = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, default=""
    )
    ticket_numbers = ReservationTicketNumberField(write_only=True)

    def create(self, validated_data):
        try:
            return create_reservation(**validated_data)
        except ReservationError as exc:
            raise serializers.ValidationError(
                {"detail": exc.message, "code": exc.code}
            ) from exc


class ReservationSerializer(serializers.ModelSerializer):
    display_id = serializers.SerializerMethodField()
    ticket_numbers = serializers.SerializerMethodField()
    printable_ticket_numbers = serializers.SerializerMethodField()
    ticket_count = serializers.SerializerMethodField()
    reserved_at = serializers.SerializerMethodField()
    cancelled_at = serializers.DateTimeField()

    class Meta:
        model = Reservation
        fields = [
            "id",
            "display_id",
            "customer_name",
            "contact_number",
            "notes",
            "status",
            "ticket_numbers",
            "printable_ticket_numbers",
            "ticket_count",
            "created_at",
            "reserved_at",
            "updated_at",
            "cancelled_at",
        ]

    def get_display_id(self, obj):
        return obj.display_id

    def get_ticket_numbers(self, obj):
        # Prefer the preloaded list when available (see view list/detail code).
        if hasattr(obj, "_prefetched_numbers"):
            return obj._prefetched_numbers
        cache = getattr(obj, "_prefetched_objects_cache", None)
        if cache is not None:
            numbers = [tl.ticket.number for tl in cache.get("ticket_links", [])]
        else:
            numbers = list(
                obj.ticket_links.select_related("ticket").values_list(
                    "ticket__number", flat=True
                )
            )
        numbers.sort()
        return [_display(n) for n in numbers]

    def get_printable_ticket_numbers(self, obj):
        """Only the still-active (reserved) tickets of an active reservation."""
        if hasattr(obj, "_printable_numbers"):
            return obj._printable_numbers
        if obj.status != ReservationStatus.ACTIVE:
            return []
        return list(
            obj.ticket_links.select_related("ticket")
            .filter(ticket__status=TicketStatus.RESERVED)
            .order_by("ticket__number")
            .values_list("ticket__number", flat=True)
        )

    def get_ticket_count(self, obj):
        return len(self.get_ticket_numbers(obj))

    def get_reserved_at(self, obj):
        return obj.created_at


class TicketDesignSerializer(serializers.ModelSerializer):
    """Read/write representation of the ticket template + sheet defaults.

    ``ticket_size_mm`` / ``ticket_size_px_300dpi`` expose the exact size guide
    for a single ticket so a background image can be designed at 1:1 scale.
    """

    ticket_width_mm = serializers.SerializerMethodField()
    ticket_height_mm = serializers.SerializerMethodField()
    ticket_width_px_300dpi = serializers.SerializerMethodField()
    ticket_height_px_300dpi = serializers.SerializerMethodField()
    background_url = serializers.SerializerMethodField()

    class Meta:
        model = TicketDesign
        fields = [
            "background",
            "background_url",
            "layout",
            "page_size",
            "page_orientation",
            "page_columns",
            "page_rows",
            "margin_mm",
            "gap_mm",
            "ticket_width_mm",
            "ticket_height_mm",
            "ticket_width_px_300dpi",
            "ticket_height_px_300dpi",
            "updated_at",
        ]
        read_only_fields = [
            "background_url",
            "ticket_width_mm",
            "ticket_height_mm",
            "ticket_width_px_300dpi",
            "ticket_height_px_300dpi",
            "updated_at",
        ]
        # ``background`` accepts the upload but is never echoed back: clients
        # must use the root-relative ``background_url`` so the image always
        # loads from the frontend origin (dev proxy / reverse proxy).
        extra_kwargs = {"background": {"write_only": True}}

    # -- size guide -----------------------------------------------------

    def _ticket_size(self, obj) -> tuple[float, float]:
        try:
            return compute_ticket_size_mm(
                obj.page_size,
                obj.page_orientation,
                obj.page_columns,
                obj.page_rows,
                obj.margin_mm,
                obj.gap_mm,
            )
        except GeometryError:
            # Fall back to a sane guide so the designer stays usable; the
            # full error is surfaced when the user saves their setup.
            return (0.0, 0.0)

    def get_ticket_width_mm(self, obj) -> float:
        return round(self._ticket_size(obj)[0], 2)

    def get_ticket_height_mm(self, obj) -> float:
        return round(self._ticket_size(obj)[1], 2)

    def get_ticket_width_px_300dpi(self, obj) -> int:
        return size_guide_mm_to_px(self._ticket_size(obj)[0])

    def get_ticket_height_px_300dpi(self, obj) -> int:
        return size_guide_mm_to_px(self._ticket_size(obj)[1])

    def get_background_url(self, obj) -> str | None:
        if not obj.background:
            return None
        try:
            return obj.background.url
        except ValueError:
            return None

    # -- validation -----------------------------------------------------

    def _ticket_size_for_data(self, data) -> tuple[float, float]:
        merged = {
            "page_size": data.get("page_size", getattr(self.instance, "page_size", "a4")),
            "page_orientation": data.get(
                "page_orientation",
                getattr(self.instance, "page_orientation", "portrait"),
            ),
            "page_columns": data.get(
                "page_columns", getattr(self.instance, "page_columns", 5)
            ),
            "page_rows": data.get("page_rows", getattr(self.instance, "page_rows", 3)),
            "margin_mm": data.get("margin_mm", getattr(self.instance, "margin_mm", 10)),
            "gap_mm": data.get("gap_mm", getattr(self.instance, "gap_mm", 4)),
        }
        return compute_ticket_size_mm(
            merged["page_size"],
            merged["page_orientation"],
            merged["page_columns"],
            merged["page_rows"],
            merged["margin_mm"],
            merged["gap_mm"],
        )

    ALLOWED_BACKGROUND_TYPES = ("image/png", "image/jpeg", "image/webp")
    MAX_BACKGROUND_BYTES = 10 * 1024 * 1024  # keep uploads light and printable

    def _validate_background(self, upload) -> None:
        """Only real images are accepted (validated without Pillow)."""
        content_type = (getattr(upload, "content_type", "") or "").lower()
        name = (getattr(upload, "name", "") or "").lower()
        extension_ok = name.endswith((".png", ".jpg", ".jpeg", ".webp"))
        if content_type not in self.ALLOWED_BACKGROUND_TYPES and not extension_ok:
            raise serializers.ValidationError(
                {
                    "detail": "The ticket background must be a PNG, JPG or WEBP image.",
                    "code": "invalid_background_type",
                }
            )
        size = getattr(upload, "size", 0) or 0
        if size > self.MAX_BACKGROUND_BYTES:
            raise serializers.ValidationError(
                {
                    "detail": "The ticket background must be 10 MB or smaller.",
                    "code": "invalid_background_size",
                }
            )

    def validate(self, attrs):
        # The merged sheet setup must be physically printable.
        try:
            self._ticket_size_for_data(attrs)
        except GeometryError as exc:
            raise serializers.ValidationError({"detail": exc.message, "code": exc.code}) from exc

        if "background" in attrs and attrs["background"]:
            self._validate_background(attrs["background"])

        if "layout" in attrs:
            try:
                attrs["layout"] = validate_design_layout(attrs["layout"])
            except GeometryError as exc:
                raise serializers.ValidationError({"detail": exc.message, "code": exc.code}) from exc

        if "page_size" in attrs:
            page_size = str(attrs["page_size"]).lower()
            if page_size not in PAPER_SIZES_MM:
                raise serializers.ValidationError(
                    {"detail": "Unsupported paper size.", "code": "invalid_page_size"}
                )
            attrs["page_size"] = page_size

        if "page_orientation" in attrs:
            orientation = str(attrs["page_orientation"]).lower()
            if orientation not in ORIENTATIONS:
                raise serializers.ValidationError(
                    {
                        "detail": "Orientation must be portrait or landscape.",
                        "code": "invalid_orientation",
                    }
                )
            attrs["page_orientation"] = orientation

        return attrs


class ReservationListSerializer(ReservationSerializer):
    """Lighter representation used for the reservations table."""

    class Meta:
        model = Reservation
        fields = [
            "id",
            "display_id",
            "customer_name",
            "contact_number",
            "status",
            "ticket_numbers",
            "ticket_count",
            "created_at",
            "reserved_at",
            "updated_at",
            "cancelled_at",
        ]


class MonitorRecentSerializer(serializers.ModelSerializer):
    display_id = serializers.SerializerMethodField()
    ticket_numbers = serializers.SerializerMethodField()
    ticket_count = serializers.SerializerMethodField()
    reserved_at = serializers.SerializerMethodField()

    class Meta:
        model = Reservation
        fields = [
            "id",
            "display_id",
            "customer_name",
            "ticket_numbers",
            "ticket_count",
            "reserved_at",
        ]

    def get_display_id(self, obj):
        return obj.display_id

    def get_ticket_numbers(self, obj):
        if hasattr(obj, "_prefetched_numbers"):
            return obj._prefetched_numbers
        cache = getattr(obj, "_prefetched_objects_cache", None)
        if cache is not None:
            numbers = [tl.ticket.number for tl in cache.get("ticket_links", [])]
        else:
            numbers = list(
                obj.ticket_links.select_related("ticket").values_list(
                    "ticket__number", flat=True
                )
            )
        numbers.sort()
        return [_display(n) for n in numbers]

    def get_ticket_count(self, obj):
        return len(self.get_ticket_numbers(obj))

    def get_reserved_at(self, obj):
        return obj.created_at