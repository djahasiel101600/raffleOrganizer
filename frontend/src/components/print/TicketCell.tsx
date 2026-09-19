/**
 * Renders a single ticket cell: the background image (designed at the exact
 * size guide) plus the positioned text elements with tokens resolved for one
 * ticket.  Used identically by the designer canvas, the print preview and the
 * printed output.
 */

import type { CSSProperties } from "react";

import { elementStyle, resolveTokens } from "@/lib/ticketDesign";
import type { DesignElement, TicketPrintContext } from "@/lib/ticketDesign";
import { cn } from "@/lib/utils";

interface TicketCellProps {
  layout: DesignElement[];
  backgroundUrl: string | null;
  /** Per-ticket token values; `null` renders an intentionally blank cell. */
  context: TicketPrintContext | null;
  /** Rendered cell size in CSS px at the current scale. */
  widthPx: number;
  heightPx: number;
  className?: string;
  style?: CSSProperties;
  /** Screen-only dashed outline for empty cells (never printed). */
  showBlankOutline?: boolean;
}

export function TicketCell({
  layout,
  backgroundUrl,
  context,
  widthPx,
  heightPx,
  className,
  style,
  showBlankOutline = false,
}: TicketCellProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden bg-white",
        showBlankOutline &&
          "outline-1 outline-dashed outline-muted-foreground/40",
        className
      )}
      style={{ width: widthPx, height: heightPx, ...style }}
    >
      {/* Blank cells (no reserved ticket) stay completely empty — the sheet's
          unused cells must never receive the background image or any content. */}
      {context !== null && backgroundUrl && (
        <img
          src={backgroundUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full select-none"
          style={{ objectFit: "fill" }}
        />
      )}
      {context !== null &&
        layout.map((element) =>
          element.type === "shape" ? (
            <div
              key={element.id}
              data-shape={element.shape}
              style={elementStyle(element, heightPx)}
            />
          ) : (
            <div key={element.id} style={elementStyle(element, heightPx)}>
              {resolveTokens(element.text, context)}
            </div>
          )
        )}
    </div>
  );
}