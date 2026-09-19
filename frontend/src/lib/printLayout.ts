/**
 * Print sheet geometry — the single source of truth for turning
 * "columns x rows on a paper size" into exact ticket cell sizes.
 *
 * The same maths drives the print center preview, the printed output and the
 * designer's size guide, so what you see is exactly what prints.  All linear
 * units are millimetres; CSS pixels use the browser's exact conversion
 * (96/25.4 px per mm) and image pixels use 300/25.4 px per mm for print-quality
 * background designs.
 */

export type PaperSizeName = "A4" | "Letter" | "Legal";
export type Orientation = "portrait" | "landscape";

export const PAPER_SIZES_MM: Record<PaperSizeName, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
};

/** Backend canonical (lowercase) values ↔ UI names. */
export function paperSizeToApi(name: PaperSizeName): string {
  return name.toLowerCase();
}

export function paperSizeFromApi(value: string | undefined): PaperSizeName {
  switch ((value ?? "").toLowerCase()) {
    case "letter":
      return "Letter";
    case "legal":
      return "Legal";
    default:
      return "A4";
  }
}

export const MM_PER_INCH = 25.4;
/** The browser's exact CSS pixel conversion (96 dpi). */
export const CSS_PX_PER_MM = 96 / MM_PER_INCH;
/** Pixels per millimetre for a 300 DPI design image. */
export const PX_PER_MM_300DPI = 300 / MM_PER_INCH;

export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 10;
export const MIN_ROWS = 1;
export const MAX_ROWS = 10;

export interface PrintGeometry {
  paperSize: PaperSizeName;
  orientation: Orientation;
  columns: number;
  rows: number;
  /** Page margin in mm (applied on all sides). */
  marginMm: number;
  /** Gap between ticket cells in mm. */
  gapMm: number;
}

export const DEFAULT_GEOMETRY: PrintGeometry = {
  paperSize: "A4",
  orientation: "portrait",
  columns: 5,
  rows: 3,
  marginMm: 10,
  gapMm: 4,
};

export interface PageSizeMm {
  widthMm: number;
  heightMm: number;
}

export function sheetSizeMm(geometry: PrintGeometry): PageSizeMm {
  const paper = PAPER_SIZES_MM[geometry.paperSize] ?? PAPER_SIZES_MM.A4;
  return geometry.orientation === "landscape"
    ? { widthMm: paper.height, heightMm: paper.width }
    : { widthMm: paper.width, heightMm: paper.height };
}

export interface TicketCellSize {
  widthMm: number;
  heightMm: number;
  /** Rendered size at 100% zoom (96 dpi CSS px). */
  widthPx: number;
  heightPx: number;
}

/**
 * Compute the fixed ticket cell size for a sheet setup.
 *
 * The cells are always exactly this size — tickets never stretch to fill a
 * sheet.  A sheet with 5 columns x 3 rows holding only 3 tickets prints 3
 * cells and leaves the remaining 12 blank.
 */
export function ticketCellSizeMm(geometry: PrintGeometry): TicketCellSize {
  const sheet = sheetSizeMm(geometry);
  const availableWidth =
    sheet.widthMm - 2 * geometry.marginMm - (geometry.columns - 1) * geometry.gapMm;
  const availableHeight =
    sheet.heightMm - 2 * geometry.marginMm - (geometry.rows - 1) * geometry.gapMm;
  const widthMm = availableWidth / geometry.columns;
  const heightMm = availableHeight / geometry.rows;
  return {
    widthMm,
    heightMm,
    widthPx: widthMm * CSS_PX_PER_MM,
    heightPx: heightMm * CSS_PX_PER_MM,
  };
}

/** Returns an error message when the setup cannot fit, otherwise null. */
export function validateGeometry(geometry: PrintGeometry): string | null {
  if (
    !Number.isFinite(geometry.columns) ||
    geometry.columns < MIN_COLUMNS ||
    geometry.columns > MAX_COLUMNS
  ) {
    return `Columns must be between ${MIN_COLUMNS} and ${MAX_COLUMNS}.`;
  }
  if (
    !Number.isFinite(geometry.rows) ||
    geometry.rows < MIN_ROWS ||
    geometry.rows > MAX_ROWS
  ) {
    return `Rows must be between ${MIN_ROWS} and ${MAX_ROWS}.`;
  }
  if (geometry.marginMm < 0 || geometry.gapMm < 0) {
    return "Margin and gap cannot be negative.";
  }
  const cell = ticketCellSizeMm(geometry);
  if (!Number.isFinite(cell.widthMm) || !Number.isFinite(cell.heightMm)) {
    return "Invalid sheet setup.";
  }
  if (cell.widthMm <= 0) {
    return "The margin and column gap are too large for the selected paper. Reduce the margin, the gap, or the number of columns.";
  }
  if (cell.heightMm <= 0) {
    return "The margin and row gap are too large for the selected paper. Reduce the margin, the gap, or the number of rows.";
  }
  return null;
}

/** Top-left origin (mm) of cell `index`, filling row-major (left→right, top→bottom). */
export function cellOriginMm(
  geometry: PrintGeometry,
  index: number
): { xMm: number; yMm: number } {
  const cell = ticketCellSizeMm(geometry);
  const column = index % geometry.columns;
  const row = Math.floor(index / geometry.columns);
  return {
    xMm: geometry.marginMm + column * (cell.widthMm + geometry.gapMm),
    yMm: geometry.marginMm + row * (cell.heightMm + geometry.gapMm),
  };
}

/** Split tickets into page groups of `perPage` cells (row-major order). */
export function paginate<T>(items: T[], perPage: number): T[][] {
  const size = Math.max(1, Math.floor(perPage));
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

export function ticketsPerPage(geometry: PrintGeometry): number {
  return geometry.columns * geometry.rows;
}

export interface TicketSizeGuide {
  widthMm: number;
  heightMm: number;
  widthIn: number;
  heightIn: number;
  /** Whole pixels for a 300 DPI background image. */
  widthPx300: number;
  heightPx300: number;
  aspect: string;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function aspectRatio(widthMm: number, heightMm: number): string {
  const w = Math.round(widthMm * 10);
  const h = Math.round(heightMm * 10);
  if (w <= 0 || h <= 0) return "—";
  const divisor = gcd(w, h);
  const rw = w / divisor;
  const rh = h / divisor;
  if (rw <= 60 && rh <= 60) return `${rw} : ${rh}`;
  return `≈ 1 : ${(rh / rw).toFixed(2)}`;
}

/**
 * The single-ticket size guide: the exact physical size of one ticket cell,
 * updating live as columns/rows/orientation/margins change.  Use it to create
 * a JPG/PNG background at 1:1 scale.
 */
export function ticketSizeGuide(geometry: PrintGeometry): TicketSizeGuide {
  const cell = ticketCellSizeMm(geometry);
  return {
    widthMm: cell.widthMm,
    heightMm: cell.heightMm,
    widthIn: cell.widthMm / MM_PER_INCH,
    heightIn: cell.heightMm / MM_PER_INCH,
    widthPx300: Math.floor(cell.widthMm * PX_PER_MM_300DPI),
    heightPx300: Math.floor(cell.heightMm * PX_PER_MM_300DPI),
    aspect: aspectRatio(cell.widthMm, cell.heightMm),
  };
}

/** The @page rule for the current sheet setup (injected per print job). */
export function pageRuleCss(geometry: PrintGeometry): string {
  const sheet = sheetSizeMm(geometry);
  return `@page { size: ${sheet.widthMm}mm ${sheet.heightMm}mm; margin: 0; }`;
}

export function formatMm(value: number): string {
  return `${value.toFixed(1)} mm`;
}
