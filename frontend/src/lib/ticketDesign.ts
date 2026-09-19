/**
 * Ticket design model — shared by the designer (editing) and the print engine
 * (rendering).
 *
 * A design is a background image (a JPG/PNG created at the exact single-ticket
 * size guide) plus a list of absolutely-positioned text elements.  Element
 * geometry is stored in percentages so the same design stays correct for any
 * sheet setup:
 *
 * - `x`, `y`     → element center, in % of the ticket width / height
 * - `fontSize`   → in % of the ticket height (scales with the cell)
 *
 * Text may contain dynamic tokens (e.g. `{number}`) that are replaced at
 * print time with each ticket's real values.
 */

import type { CSSProperties } from "react";

export type TextAlign = "left" | "center" | "right";
export type ElementType = "text" | "shape";
export type ShapeKind = "rectangle" | "ellipse";

export interface DesignElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  /** Rotation in degrees (-180 … 180), applied around the element center. */
  rotation: number;
  color: string;
  // ---- text-only fields ----
  text: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  uppercase: boolean;
  align: TextAlign;
  fontFamily: string;
  lineHeight: number;
  // ---- shape-only fields ----
  shape: ShapeKind;
  /** Shape size in % of the ticket width / height. */
  width: number;
  height: number;
  fill: string;
  strokeColor: string;
  strokeWidth: number;
}

export interface TicketDesignPayload {
  background_url: string | null;
  layout: DesignElement[];
  page_size: string;
  page_orientation: string;
  page_columns: number;
  page_rows: number;
  margin_mm: number;
  gap_mm: number;
  ticket_width_mm: number;
  ticket_height_mm: number;
  ticket_width_px_300dpi: number;
  ticket_height_px_300dpi: number;
  updated_at: string | null;
}

/** The per-ticket values available to template tokens at print time. */
export interface TicketPrintContext {
  number: string;
  raffle: string;
  customer: string;
  contact: string;
  date: string;
  reservation: string;
}

export interface TokenSpec {
  token: string;
  label: string;
  sample: string;
}

export const TOKENS: TokenSpec[] = [
  { token: "{number}", label: "Ticket number", sample: "0042" },
  { token: "{raffle}", label: "Raffle name", sample: "Community Raffle" },
  { token: "{customer}", label: "Customer name", sample: "Juan Dela Cruz" },
  { token: "{contact}", label: "Contact number", sample: "0917 123 4567" },
  { token: "{date}", label: "Reserved date", sample: "September 19, 2026" },
  { token: "{reservation}", label: "Reservation ID", sample: "R-000123" },
];

/** Sample values used on the designer canvas. */
export const SAMPLE_CONTEXT: TicketPrintContext = Object.fromEntries(
  TOKENS.map((spec) => [spec.token.slice(1, -1), spec.sample])
) as unknown as TicketPrintContext;

export const FONT_FAMILIES = [
  // Sans-serif
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', Tahoma, sans-serif" },

  // Serif
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },

  // Monospace
  { label: "Courier New", value: "'Courier New', Courier, monospace" },

  // Display
  { label: "Impact", value: "Impact, 'Arial Black', sans-serif" },

  // Script / Handwritten
  { label: "Pacifico", value: "Pacifico, cursive" },
  { label: "Lobster", value: "Lobster, cursive" },
  { label: "Dancing Script", value: "'Dancing Script', cursive" },
  { label: "Great Vibes", value: "'Great Vibes', cursive" },
  { label: "Allura", value: "Allura, cursive" },
  { label: "Alex Brush", value: "'Alex Brush', cursive" },
  { label: "Satisfy", value: "Satisfy, cursive" },
  { label: "Sacramento", value: "Sacramento, cursive" },
  { label: "Cookie", value: "Cookie, cursive" },
  { label: "Caveat", value: "Caveat, cursive" },
  { label: "Kalam", value: "Kalam, cursive" },
];

export const DEFAULT_FONT_FAMILY = FONT_FAMILIES[0].value;

/** Replace `{token}` placeholders; unknown tokens are left as-is. */
export function resolveTokens(text: string, context: TicketPrintContext): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = (context as unknown as Record<string, string | undefined>)[key];
    return value === undefined ? match : value;
  });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Compute the inline style that renders an element inside a ticket cell. */
export function elementStyle(
  element: DesignElement,
  cellHeightPx: number
): CSSProperties {
  const rotation = element.rotation || 0;
  const common: CSSProperties = {
    position: "absolute",
    left: `${element.x}%`,
    top: `${element.y}%`,
    transform: `translate(-50%, -50%)${rotation ? ` rotate(${rotation}deg)` : ""}`,
    transformOrigin: "center",
  };
  if (element.type === "shape") {
    return {
      ...common,
      width: `${element.width}%`,
      height: `${element.height}%`,
      backgroundColor: element.fill,
      border:
        element.strokeWidth > 0
          ? `${element.strokeWidth}px solid ${element.strokeColor}`
          : undefined,
      borderRadius: element.shape === "ellipse" ? "50%" : undefined,
      boxSizing: "border-box",
    };
  }
  return {
    ...common,
    // Size the box to the rendered text (not the shrink-to-fit cap), so the
    // translate(-50%) center point is the true visual center and wide text
    // overflows symmetrically instead of wrapping early.
    width: "max-content",
    fontFamily: element.fontFamily,
    fontSize: `${(element.fontSize / 100) * cellHeightPx}px`,
    fontWeight: element.bold ? 700 : 400,
    fontStyle: element.italic ? "italic" : "normal",
    textDecoration: element.underline ? "underline" : "none",
    textTransform: element.uppercase ? "uppercase" : "none",
    textAlign: element.align,
    color: element.color,
    lineHeight: element.lineHeight,
    // Only explicit newlines (typed in the designer's textarea) break lines —
    // spaces must never act as line breaks ("pre-wrap" wrapped at every space
    // once the text outgrew the cell).
    whiteSpace: "pre",
  };
}

export function newElementId(): string {
  return `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function baseElement(patch: Partial<DesignElement> = {}): DesignElement {
  return {
    id: newElementId(),
    type: "text",
    x: 50,
    y: 50,
    rotation: 0,
    color: "#111827",
    // text defaults
    text: "New text",
    fontSize: 6,
    bold: false,
    italic: false,
    underline: false,
    uppercase: false,
    align: "center",
    fontFamily: DEFAULT_FONT_FAMILY,
    lineHeight: 1.2,
    // shape defaults
    shape: "rectangle",
    width: 30,
    height: 12,
    fill: "#2563eb",
    strokeColor: "#1e3a8a",
    strokeWidth: 0,
    ...patch,
  };
}

export function createElement(patch: Partial<DesignElement> = {}): DesignElement {
  return baseElement({ type: "text", ...patch });
}

/** A shape (colored rectangle / ellipse) added to the design. */
export function createShapeElement(
  shape: ShapeKind,
  patch: Partial<DesignElement> = {}
): DesignElement {
  return baseElement({ type: "shape", text: "", shape, ...patch });
}

/** A sensible starter template used when no design has been saved yet. */
export function defaultLayout(): DesignElement[] {
  return [
    baseElement({
      id: "tpl-raffle",
      text: "{raffle}",
      x: 50,
      y: 10,
      fontSize: 7,
      bold: true,
      uppercase: true,
    }),
    baseElement({
      id: "tpl-label",
      text: "TICKET NO.",
      x: 50,
      y: 30,
      fontSize: 4.5,
      color: "#6b7280",
    }),
    baseElement({
      id: "tpl-number",
      text: "{number}",
      x: 50,
      y: 50,
      fontSize: 22,
      bold: true,
    }),
    baseElement({
      id: "tpl-customer",
      text: "{customer}",
      x: 50,
      y: 78,
      fontSize: 5.5,
      bold: true,
      color: "#1f2937",
    }),
    baseElement({
      id: "tpl-date",
      text: "{date}",
      x: 50,
      y: 90,
      fontSize: 4,
      color: "#6b7280",
    }),
  ];
}

/** Clean a payload layout into fully-typed elements. */
export function normalizeLayout(raw: unknown): DesignElement[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null
    )
    .map((item, index) => {
      const shared = {
        id: typeof item.id === "string" && item.id ? item.id : `el-${index}`,
        x: clamp(Number(item.x ?? 50), 0, 100),
        y: clamp(Number(item.y ?? 50), 0, 100),
        rotation: clamp(Number(item.rotation ?? 0), -180, 180),
        color:
          typeof item.color === "string" && /^#[0-9a-fA-F]{6}$/.test(item.color)
            ? item.color
            : "#111827",
      };
      if (item.type === "shape") {
        return baseElement({
          ...shared,
          type: "shape",
          text: "",
          shape: item.shape === "ellipse" ? "ellipse" : "rectangle",
          width: clamp(Number(item.width ?? 30), 1, 200),
          height: clamp(Number(item.height ?? 12), 1, 200),
          fill: hexColor(item.fill, "#2563eb"),
          strokeColor: hexColor(item.strokeColor, "#1e3a8a"),
          strokeWidth: clamp(Number(item.strokeWidth ?? 0), 0, 50),
        });
      }
      return baseElement({
        ...shared,
        type: "text",
        text: typeof item.text === "string" ? item.text : "",
        fontSize: clamp(Number(item.fontSize ?? 6), 0.5, 100),
        bold: Boolean(item.bold),
        italic: Boolean(item.italic),
        underline: Boolean(item.underline),
        uppercase: Boolean(item.uppercase),
        align:
          item.align === "left" || item.align === "right" || item.align === "center"
            ? item.align
            : "center",
        fontFamily:
          typeof item.fontFamily === "string" && item.fontFamily
            ? item.fontFamily
            : DEFAULT_FONT_FAMILY,
        lineHeight: clamp(Number(item.lineHeight ?? 1.2), 0.5, 4),
      });
    });
}

function hexColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value
    : fallback;
}

export type AlignMode =
  | "left"
  | "centerX"
  | "right"
  | "top"
  | "middleY"
  | "bottom";

/**
 * Align multiple elements by their centers (elements are positioned by center
 * point): left/top line the smallest x/y up, right/bottom the largest, and
 * center/middle average them.  Returns patches keyed by element id.
 */
export function alignElements(
  elements: DesignElement[],
  mode: AlignMode
): { id: string; x?: number; y?: number }[] {
  if (elements.length < 2) return [];
  const xs = elements.map((element) => element.x);
  const ys = elements.map((element) => element.y);
  const targetX =
    mode === "left"
      ? Math.min(...xs)
      : mode === "right"
        ? Math.max(...xs)
        : mode === "centerX"
          ? xs.reduce((sum, value) => sum + value, 0) / xs.length
          : null;
  const targetY =
    mode === "top"
      ? Math.min(...ys)
      : mode === "bottom"
        ? Math.max(...ys)
        : mode === "middleY"
          ? ys.reduce((sum, value) => sum + value, 0) / ys.length
          : null;
  return elements.map((element) => ({
    id: element.id,
    ...(targetX !== null ? { x: clamp(targetX, 0, 100) } : {}),
    ...(targetY !== null ? { y: clamp(targetY, 0, 100) } : {}),
  }));
}