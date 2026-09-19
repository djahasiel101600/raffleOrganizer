/**
 * Shareable ticket-design templates.
 *
 * A template is a single self-contained JSON file — the element layout, the
 * sheet setup (paper / orientation / columns / rows / margin / gap) and, when
 * the design has one, the background image embedded as base64.  Exporting
 * produces a file that can be attached to an e-mail or chat message; importing
 * loads it back into the Ticket Designer as pending (unsaved) changes.
 */

import { normalizeLayout } from "@/lib/ticketDesign";
import type { DesignElement } from "@/lib/ticketDesign";
import {
  MAX_COLUMNS,
  MAX_ROWS,
  paperSizeFromApi,
  validateGeometry,
} from "@/lib/printLayout";
import type { PrintGeometry } from "@/lib/printLayout";

export const TEMPLATE_FORMAT = "raffle-ticket-design-template";
export const TEMPLATE_VERSION = 1;
/** Mirrors the API's upload limit so templates never fail to save. */
export const TEMPLATE_MAX_BACKGROUND_BYTES = 10 * 1024 * 1024;

export interface TemplateBackgroundPayload {
  name: string;
  contentType: string;
  base64: string;
}

export interface ParsedTemplate {
  name: string;
  /** Fully normalized elements, ready for `setLayout`. */
  layout: DesignElement[];
  /** Validated sheet setup, or `null` when it is not printable (caller warns). */
  geometry: PrintGeometry | null;
  /** Background image as a `File`, or `null` when the template has none. */
  background: File | null;
}

/** Raised when an imported template file is not usable; message is UI-ready. */
export class TemplateError extends Error {}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function buildTemplateJson(input: {
  name: string;
  layout: DesignElement[];
  geometry: PrintGeometry;
  background: TemplateBackgroundPayload | null;
}): string {
  return JSON.stringify({
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    name: input.name.trim() || "Ticket design",
    exported_at: new Date().toISOString(),
    design: {
      layout: input.layout,
      page_size: input.geometry.paperSize.toLowerCase(),
      page_orientation: input.geometry.orientation,
      page_columns: input.geometry.columns,
      page_rows: input.geometry.rows,
      margin_mm: input.geometry.marginMm,
      gap_mm: input.geometry.gapMm,
    },
    // Wire format is snake_case (matching the design section); the in-memory
    // payload is camelCase.
    background: input.background
      ? {
          name: input.background.name,
          content_type: input.background.contentType,
          data_base64: input.background.base64,
        }
      : null,
  });
}

/** Filesystem-safe download name for an exported template. */
export function templateFileName(name: string, now = new Date()): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "design";
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `raffle-ticket-template-${slug}-${stamp}.json`;
}

/** Trigger a browser download for the given text content. */
export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
/** Read any image source (file or same-origin URL) into a base64 payload. */
export async function backgroundPayloadFromFile(
  file: File
): Promise<TemplateBackgroundPayload> {
  return {
    name: file.name,
    contentType: contentTypeFor(file.name, file.type),
    base64: await blobToBase64(file),
  };
}

export async function backgroundPayloadFromUrl(
  url: string
): Promise<TemplateBackgroundPayload> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Background request failed (${response.status}).`);
  }
  const blob = await response.blob();
  const name = url.split("/").pop() || "background";
  return {
    name,
    contentType: contentTypeFor(name, blob.type),
    base64: await blobToBase64(blob),
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export function parseTemplateJson(text: string): ParsedTemplate {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TemplateError("That file is not valid JSON.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TemplateError("That file is not a ticket design template.");
  }
  const root = raw as Record<string, unknown>;
  if (root.format !== TEMPLATE_FORMAT) {
    throw new TemplateError(
      "That file is not a raffle ticket design template (missing format marker)."
    );
  }
  if (root.version !== TEMPLATE_VERSION) {
    throw new TemplateError(
      "This template uses an unsupported version. Update the application and try again."
    );
  }

  const design =
    root.design && typeof root.design === "object"
      ? (root.design as Record<string, unknown>)
      : {};

  const layout = normalizeLayout(design.layout);
  if (layout.length === 0) {
    throw new TemplateError("The template contains no design elements.");
  }

  const geometry = parseGeometry(design);
  const usableGeometry =
    geometry && validateGeometry(geometry) === null ? geometry : null;

  return {
    name:
      typeof root.name === "string" && root.name.trim()
        ? root.name.trim()
        : "Imported template",
    layout,
    geometry: usableGeometry,
    background: parseBackground(root.background),
  };
}

function parseGeometry(design: Record<string, unknown>): PrintGeometry | null {
  if (design.page_columns === undefined && design.page_rows === undefined) {
    // Very old exports may omit the sheet setup entirely.
    return null;
  }
  const numberOr = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return {
    paperSize: paperSizeFromApi(
      typeof design.page_size === "string" ? design.page_size : undefined
    ),
    orientation:
      design.page_orientation === "landscape" ? "landscape" : "portrait",
    columns: Math.max(
      1,
      Math.min(MAX_COLUMNS, Math.round(numberOr(design.page_columns, 5)))
    ),
    rows: Math.max(
      1,
      Math.min(MAX_ROWS, Math.round(numberOr(design.page_rows, 3)))
    ),
    marginMm: Math.max(0, numberOr(design.margin_mm, 10)),
    gapMm: Math.max(0, numberOr(design.gap_mm, 4)),
  };
}

function parseBackground(raw: unknown): File | null {
  if (!raw || typeof raw !== "object") return null;
  const { name, content_type: contentTypeRaw, data_base64: base64 } =
    raw as Record<string, unknown>;
  if (typeof base64 !== "string" || base64.length === 0) return null;

  const fileName =
    typeof name === "string" && name.trim() ? name.trim() : "background";
  const contentType = contentTypeFor(fileName, String(contentTypeRaw ?? ""));
  if (!isSupportedImage(fileName, contentType)) {
    throw new TemplateError(
      "The template's background must be a PNG, JPG or WEBP image."
    );
  }
  const blob = base64ToBlob(base64, contentType);
  if (blob.size > TEMPLATE_MAX_BACKGROUND_BYTES) {
    throw new TemplateError(
      "The template's background image exceeds the 10 MB upload limit."
    );
  }
  return new File([blob], fileName, { type: contentType });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSupportedImage(name: string, contentType: string): boolean {
  return (
    ["image/png", "image/jpeg", "image/webp"].includes(contentType) ||
    /\.(png|jpe?g|webp)$/i.test(name)
  );
}

function contentTypeFor(name: string, fallback: string): string {
  const normalized = (fallback || "").toLowerCase();
  if (["image/png", "image/jpeg", "image/webp"].includes(normalized)) {
    return normalized;
  }
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "image/jpeg";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : "");
    };
    reader.onerror = () => reject(new Error("Unable to read the image."));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: contentType });
}