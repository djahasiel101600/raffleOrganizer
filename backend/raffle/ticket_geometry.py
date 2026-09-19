"""Ticket geometry helpers.

Single source of truth for print-sheet and single-ticket geometry, shared by
the designer (size guide, canvas) and the print center (sheet layout).  All
linear units are millimetres; 1 mm = 96/25.4 CSS px for on-screen rendering
and 300/25.4 px for 300-DPI image design exports.
"""

from math import floor

# Standard paper sizes in millimetres (width x height, portrait).
# Keys are lowercase; use page_dimensions_mm() for case-insensitive lookup.
PAPER_SIZES_MM = {
    "a4": (210.0, 297.0),
    "letter": (215.9, 279.4),
    "legal": (215.9, 355.6),
}

ORIENTATIONS = ("portrait", "landscape")

MIN_COLUMNS = 1
MAX_COLUMNS = 10
MIN_ROWS = 1
MAX_ROWS = 10

MM_PER_INCH = 25.4
CSS_PX_PER_MM = 96.0 / MM_PER_INCH
PX_PER_MM_AT_300DPI = 300.0 / MM_PER_INCH


class GeometryError(ValueError):
    """Raised when a sheet setup cannot physically fit its tickets."""

    def __init__(self, message: str, code: str = "invalid_geometry"):
        super().__init__(message)
        self.code = code
        self.message = message


def page_dimensions_mm(page_size: str, orientation: str) -> tuple[float, float]:
    """Return (width_mm, height_mm) for the paper/orientation combo."""
    width, height = PAPER_SIZES_MM.get(
        str(page_size or "a4").lower(), PAPER_SIZES_MM["a4"]
    )
    if str(orientation or "portrait").lower() == "landscape":
        return (height, width)
    return (width, height)


def compute_ticket_size_mm(
    page_size: str,
    orientation: str,
    columns: int,
    rows: int,
    margin_mm: float,
    gap_mm: float,
) -> tuple[float, float]:
    """Return (width_mm, height_mm) of a single ticket cell on the sheet.

    Raises GeometryError when the setup is impossible (non-positive counts,
    margin/gap too large, or cells that would have non-positive size).
    """
    try:
        columns = int(columns)
        rows = int(rows)
        margin = float(margin_mm)
        gap = float(gap_mm)
    except (TypeError, ValueError):
        raise GeometryError("Invalid sheet setup values.") from None

    if columns < MIN_COLUMNS or rows < MIN_ROWS:
        raise GeometryError("Columns and rows must each be at least 1.")
    if columns > MAX_COLUMNS or rows > MAX_ROWS:
        raise GeometryError(f"Columns and rows are limited to {MAX_COLUMNS}.")
    if margin < 0 or gap < 0:
        raise GeometryError("Margin and gap cannot be negative.")

    page_w, page_h = page_dimensions_mm(page_size, orientation)

    available_w = page_w - 2 * margin - (columns - 1) * gap
    available_h = page_h - 2 * margin - (rows - 1) * gap

    if available_w <= 0:
        raise GeometryError(
            "The margin and column gap are too large for the selected paper. "
            "Reduce the margin, the gap, or the number of columns."
        )
    if available_h <= 0:
        raise GeometryError(
            "The margin and row gap are too large for the selected paper. "
            "Reduce the margin, the gap, or the number of rows."
        )

    return (available_w / columns, available_h / rows)


def _clean_color(value, fallback: str) -> str:
    """Normalize a #rrggbb color; anything else falls back."""
    color = str(value or fallback)
    if len(color) == 7 and color.startswith("#"):
        return color.lower()
    return fallback


def validate_design_layout(layout) -> list[dict]:
    """Validate the designer layout payload and return a clean copy.

    Element geometry is stored as percentages so a design scales with any
    ticket size: ``x``/``y`` are the element's center in percent of the ticket
    width/height, ``fontSize`` is in percent of the ticket height, and shape
    ``width``/``height`` are percent of the ticket width/height.
    """
    if layout in (None, ""):
        return []
    if not isinstance(layout, list):
        raise GeometryError("Layout must be a list of elements.")

    cleaned: list[dict] = []
    for index, item in enumerate(layout):
        if not isinstance(item, dict):
            raise GeometryError(f"Layout element {index + 1} is invalid.")

        try:
            x = float(item.get("x", 0))
            y = float(item.get("y", 0))
        except (TypeError, ValueError):
            raise GeometryError(
                f"Layout element {index + 1} has invalid position."
            ) from None
        if not (0 <= x <= 100) or not (0 <= y <= 100):
            raise GeometryError(
                f"Element {index + 1} position must be within 0-100 percent "
                "of the ticket size."
            )

        try:
            rotation = float(item.get("rotation", 0))
        except (TypeError, ValueError):
            raise GeometryError(
                f"Element {index + 1} has an invalid rotation."
            ) from None
        if not (-180 <= rotation <= 180):
            raise GeometryError(
                f"Element {index + 1} rotation must be between -180 and 180 degrees."
            )

        is_shape = item.get("type") == "shape"
        if is_shape:
            shape = str(item.get("shape") or "rectangle").lower()
            if shape not in ("rectangle", "ellipse"):
                raise GeometryError(
                    f"Element {index + 1} shape must be rectangle or ellipse."
                )
            try:
                width = float(item.get("width", 30))
                height = float(item.get("height", 12))
                stroke_width = float(item.get("strokeWidth", 0))
            except (TypeError, ValueError):
                raise GeometryError(
                    f"Element {index + 1} has an invalid shape size."
                ) from None
            if not (0 < width <= 200) or not (0 < height <= 200):
                raise GeometryError(
                    f"Shape {index + 1} size must be 0-200 percent of the ticket."
                )
            if not (0 <= stroke_width <= 50):
                raise GeometryError(
                    f"Shape {index + 1} stroke width must be 0-50 px."
                )
            cleaned.append(
                {
                    "id": str(item.get("id") or f"el-{index + 1}"),
                    "type": "shape",
                    "shape": shape,
                    "x": round(x, 2),
                    "y": round(y, 2),
                    "rotation": round(rotation, 2),
                    "width": round(width, 2),
                    "height": round(height, 2),
                    "fill": _clean_color(item.get("fill"), "#2563eb"),
                    "strokeColor": _clean_color(item.get("strokeColor"), "#1e3a8a"),
                    "strokeWidth": round(stroke_width, 2),
                }
            )
            continue

        # ---- text element ----
        text = item.get("text")
        if not isinstance(text, str):
            raise GeometryError(f"Layout element {index + 1} has no text.")

        try:
            font_size = float(item.get("fontSize", 12))
            line_height = float(item.get("lineHeight", 1.2))
        except (TypeError, ValueError):
            raise GeometryError(
                f"Layout element {index + 1} has invalid position or size."
            ) from None

        if font_size <= 0 or font_size > 100:
            raise GeometryError(
                f"Element {index + 1} font size must be 0-100 percent of the "
                "ticket height."
            )
        if line_height <= 0 or line_height > 4:
            raise GeometryError(f"Element {index + 1} has an invalid line height.")

        align = str(item.get("align") or "left").lower()
        if align not in ("left", "center", "right"):
            align = "left"

        cleaned.append(
            {
                "id": str(item.get("id") or f"el-{index + 1}"),
                "type": "text",
                "text": text[:500],
                "x": round(x, 2),
                "y": round(y, 2),
                "rotation": round(rotation, 2),
                "fontSize": round(font_size, 2),
                "bold": bool(item.get("bold", False)),
                "italic": bool(item.get("italic", False)),
                "underline": bool(item.get("underline", False)),
                "uppercase": bool(item.get("uppercase", False)),
                "align": align,
                "color": _clean_color(item.get("color"), "#000000"),
                "fontFamily": str(item.get("fontFamily") or "Arial"),
                "lineHeight": round(line_height, 2),
            }
        )

    if len(cleaned) > 50:
        raise GeometryError("A ticket design can have at most 50 elements.")
    return cleaned


def tickets_per_page(columns: int, rows: int) -> int:
    return max(1, int(columns)) * max(1, int(rows))


def paginate_ticket_numbers(
    ticket_numbers: list[str], per_page: int
) -> list[list[str]]:
    """Split ticket numbers into fixed-size page groups (row-major order).

    The last page keeps only its real tickets — the remaining sheet cells are
    intentionally left blank, exactly as the configured grid defines them.
    """
    per_page = max(1, int(per_page))
    return [
        list(ticket_numbers[i : i + per_page])
        for i in range(0, len(ticket_numbers), per_page)
    ]


def size_guide_mm_to_px(size_mm: float, dpi: float = 300.0) -> int:
    """Convert a millimetre size to whole pixels at the given DPI (rounded down)."""
    return floor(size_mm / MM_PER_INCH * dpi)

