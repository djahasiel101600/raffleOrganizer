/**
 * Live single-ticket size guide.
 *
 * Shown wherever columns/rows/orientation change (print center + designer).
 * Gives the exact physical size of ONE ticket cell — not the whole sheet —
 * so the administrator can create a JPG/PNG background at 1:1 scale.
 */

import { ticketSizeGuide } from "@/lib/printLayout";
import type { PrintGeometry } from "@/lib/printLayout";
import { cn } from "@/lib/utils";

export function SizeGuide({
  geometry,
  className,
}: {
  geometry: PrintGeometry;
  className?: string;
}) {
  const guide = ticketSizeGuide(geometry);
  const invalid =
    !Number.isFinite(guide.widthMm) || guide.widthMm <= 0 || guide.heightMm <= 0;

  return (
    <div
      className={cn(
        "space-y-1.5 rounded-md border border-primary/20 bg-primary/5 p-3",
        className
      )}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">
        Single ticket size guide
      </div>
      {invalid ? (
        <p className="text-xs text-destructive">
          This setup does not fit on the selected paper.
        </p>
      ) : (
        <>
          <div className="text-sm font-semibold tabular-nums">
            {guide.widthMm.toFixed(1)} × {guide.heightMm.toFixed(1)} mm
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {guide.widthIn.toFixed(2)} × {guide.heightIn.toFixed(2)} in · aspect
            ratio {guide.aspect}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            Design image: {guide.widthPx300} × {guide.heightPx300} px @ 300 DPI
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Create your JPG/PNG background at exactly this size (or any multiple
            of it), then upload it in the{" "}
            <strong>Ticket Designer</strong> so it fills one ticket perfectly.
          </p>
        </>
      )}
    </div>
  );
}