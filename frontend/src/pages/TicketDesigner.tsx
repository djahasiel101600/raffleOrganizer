/**
 * Ticket Designer — a small studio for laying out the printable ticket.
 *
 * The canvas shows ONE ticket at its exact cell size (from the sheet setup).
 * Text elements can be dragged, rotated, nudged with the arrow keys and
 * formatted. Shapes (rectangle / ellipse) can be added with configurable
 * fill / border colors and sizes. Several elements can be selected
 * (ctrl/cmd-click) and aligned or moved together. Text supports tokens such as
 * {number}, {customer} and {date}.
 *
 * Real-data safety:
 *  - "Preview data" lets you test the layout with realistic or deliberately
 *    long values instead of the short sample data.
 *  - Text that runs off the ticket or collides with other text is flagged on
 *    the canvas and listed under the toolbar, with a one-click "Auto-fit".
 *
 * Nothing here adds new persisted fields: the saved layout / API contract is
 * identical to before.
 */

// pages/TicketDesigner.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  AlignCenter,
  AlignCenterHorizontal,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDown,
  ArrowUp,
  Bold,
  CaseUpper,
  Circle,
  Copy,
  FileDown,
  FileUp,
  Image as ImageIcon,
  Italic,
  Loader2,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Square,
  Trash2,
  Type,
  Underline,
  Undo2,
  Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { fetchTicketDesign, saveTicketDesign } from "@/services/ticketDesign";
import { ApiClientError } from "@/services/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/text-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  DEFAULT_GEOMETRY,
  MAX_COLUMNS,
  MAX_ROWS,
  paperSizeFromApi,
  paperSizeToApi,
  ticketCellSizeMm,
  validateGeometry,
} from "@/lib/printLayout";
import type { PrintGeometry } from "@/lib/printLayout";
import {
  FONT_FAMILIES,
  SAMPLE_CONTEXT,
  TOKENS,
  alignElements,
  clamp,
  createElement,
  createShapeElement,
  defaultLayout,
  elementStyle,
  newElementId,
  normalizeLayout,
  resolveTokens,
} from "@/lib/ticketDesign";
import type { AlignMode, DesignElement, ShapeKind } from "@/lib/ticketDesign";
import {
  TemplateError,
  backgroundPayloadFromFile,
  backgroundPayloadFromUrl,
  buildTemplateJson,
  downloadTextFile,
  parseTemplateJson,
  templateFileName,
} from "@/lib/designTemplate";
import type { TemplateBackgroundPayload } from "@/lib/designTemplate";
import { cn } from "@/lib/utils";
import { SizeGuide } from "@/components/print/SizeGuide";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

interface DragState {
  mode: "move" | "rotate";
  id: string;
  startX: number;
  startY: number;
  /** Per-element origins captured at drag start (multi-selection move). */
  origins: { id: string; x: number; y: number }[];
  cellWidth: number;
  cellHeight: number;
  /** Rotation-only fields. */
  origRotation: number;
  centerX: number;
  centerY: number;
  startAngle: number;
}

/** Layout problems found by measuring the rendered canvas. */
interface ElementIssue {
  /** The text extends beyond the ticket edge. */
  outside: boolean;
  /** Ids of other text elements it visibly collides with. */
  overlaps: string[];
}

type PreviewValues = Record<string, string>;
type ZoomMode = "fit" | "0.5" | "0.75" | "1" | "1.5" | "2";

const BACKGROUND_INPUT_ID = "ticket-background-input";
const TEMPLATE_INPUT_ID = "ticket-template-input";

/** Hard cap so a runaway design cannot make printing sluggish. */
const MAX_ELEMENTS = 100;
const HISTORY_LIMIT = 100;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Quick fill/border presets for shapes. */
const SHAPE_PRESETS = [
  { fill: "#2563eb", stroke: "#1e3a8a" },
  { fill: "#f59e0b", stroke: "#b45309" },
  { fill: "#10b981", stroke: "#047857" },
  { fill: "#ef4444", stroke: "#b91c1c" },
];

/** Swatch palette offered for colors. */
const SWATCHES = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#3b82f6",
  "#6366f1", "#8b5cf6", "#a855f7", "#ec4899", "#f43f5e",
  "#0f172a", "#475569", "#94a3b8", "#e2e8f0", "#ffffff",
];

/** Multi-element alignment actions shown when several elements are selected. */
const ALIGN_ACTIONS: { mode: AlignMode; title: string; icon: LucideIcon }[] = [
  { mode: "left", title: "Align left edges", icon: AlignLeft },
  { mode: "centerX", title: "Align horizontal centers", icon: AlignCenterHorizontal },
  { mode: "right", title: "Align right edges", icon: AlignRight },
  { mode: "top", title: "Align top edges", icon: AlignVerticalJustifyStart },
  { mode: "middleY", title: "Align vertical centers", icon: AlignVerticalJustifyCenter },
  { mode: "bottom", title: "Align bottom edges", icon: AlignVerticalJustifyEnd },
];

const SHORTCUTS: [string, string][] = [
  ["Click / Ctrl-click", "Select / add to selection"],
  ["Arrow keys", "Nudge (Shift = bigger steps)"],
  ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
  ["Ctrl+D", "Duplicate"],
  ["Delete", "Remove selection"],
  ["Esc", "Clear selection"],
  ["Ctrl+S", "Save design"],
];

/** Collect the string entries of the sample data (the fields users can edit). */
function sampleValues(): PreviewValues {
  const out: PreviewValues = {};
  for (const [key, value] of Object.entries(SAMPLE_CONTEXT as object)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** Roughly double a value's length — used to stress-test long real-world data. */
function stretchValue(value: string): string {
  if (value.length < 3) return value;
  const target = Math.max(24, value.length * 2);
  let out = value;
  while (out.length < target) out += ` ${value}`;
  return out.slice(0, target).trim();
}

function tokenLabel(key: string): string {
  const match = TOKENS.find((token) => token.token === `{${key}}`);
  return match?.label ?? key;
}

function isEditableTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  ) {
    return true;
  }
  // Open dropdowns / dialogs own the arrow keys.
  return Boolean(target.closest('[role="listbox"],[role="menu"],[role="dialog"]'));
}

// ---------------------------------------------------------------------------
// Small reusable controls
// ---------------------------------------------------------------------------

/**
 * Number input that lets the user clear and retype freely.  Valid numbers are
 * applied live (clamped); the raw text is only replaced on blur.
 */
function NumberField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = String(Math.round(value * 100) / 100);
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        className="h-8"
        value={draft ?? shown}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = parseFloat(event.target.value);
          if (Number.isFinite(parsed)) onChange(clamp(parsed, min, max));
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

/**
 * Colour control: native picker (live), hex field (applied once it is a valid
 * 6-digit hex) and the shared swatch palette.
 */
function ColorField({
  label,
  value,
  onChange,
  swatches = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  swatches?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const pickerValue = HEX_COLOR.test(value) ? value : "#000000";
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          aria-label={`${label} picker`}
          className="h-8 w-12 cursor-pointer p-0"
          value={pickerValue}
          onChange={(event) => onChange(event.target.value)}
        />
        <Input
          type="text"
          aria-label={`${label} hex value`}
          className="h-8 font-mono text-xs"
          maxLength={7}
          value={draft ?? value}
          onChange={(event) => {
            let next = event.target.value.trim();
            if (next && !next.startsWith("#")) next = `#${next}`;
            setDraft(next);
            if (HEX_COLOR.test(next)) onChange(next.toLowerCase());
          }}
          onBlur={() => setDraft(null)}
        />
      </div>
      {swatches && (
        <div className="flex flex-wrap gap-1">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              title={swatch}
              aria-label={`Use ${swatch}`}
              className={cn(
                "h-5 w-5 rounded border border-border",
                value.toLowerCase() === swatch && "ring-2 ring-primary ring-offset-1"
              )}
              style={{ backgroundColor: swatch }}
              onClick={() => onChange(swatch)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ToggleButton({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        "rounded p-1.5 hover:bg-accent",
        active && "bg-accent text-primary"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SectionTitle({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </div>
      {aside}
    </div>
  );
}

/** Card whose body can be folded away, to keep the side column uncluttered. */
function CollapsibleCard({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <details open={defaultOpen} className="group">
        <summary className="cursor-pointer list-none px-6 py-4 [&::-webkit-details-marker]:hidden">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription className="mt-1.5">{description}</CardDescription>
            </div>
            <span className="mt-1 text-xs text-muted-foreground group-open:hidden">
              Show
            </span>
            <span className="mt-1 hidden text-xs text-muted-foreground group-open:inline">
              Hide
            </span>
          </div>
        </summary>
        <CardContent className="space-y-3 pt-0">{children}</CardContent>
      </details>
    </Card>
  );
}

/** Shape-only properties (size, fill, border). Position is shared below. */
function ShapeInspector({
  element,
  onChange,
}: {
  element: DesignElement;
  onChange: (patch: Partial<DesignElement>) => void;
}) {
  return (
    <div className="space-y-3">
      <SectionTitle>Shape</SectionTitle>
      <div className="space-y-1">
        <Label htmlFor="d-shape" className="text-xs">
          Type
        </Label>
        <Select
          value={element.shape}
          onValueChange={(value) => onChange({ shape: value as ShapeKind })}
        >
          <SelectTrigger id="d-shape" className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rectangle">Rectangle</SelectItem>
            <SelectItem value="ellipse">Ellipse</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Quick styles</Label>
        <div className="flex flex-wrap gap-1">
          {SHAPE_PRESETS.map((preset) => (
            <button
              key={preset.fill}
              type="button"
              title={`Fill ${preset.fill}`}
              aria-label={`Quick style ${preset.fill}`}
              className="h-6 w-6 rounded border border-border"
              style={{ backgroundColor: preset.fill }}
              onClick={() =>
                onChange({ fill: preset.fill, strokeColor: preset.stroke })
              }
            />
          ))}
        </div>
      </div>

      <ColorField
        label="Fill color"
        value={element.fill}
        onChange={(value) => onChange({ fill: value })}
      />
      <ColorField
        label="Border color"
        value={element.strokeColor}
        onChange={(value) => onChange({ strokeColor: value })}
      />

      <div className="grid grid-cols-3 gap-2">
        <NumberField
          id="d-shape-w"
          label="Width (%)"
          value={element.width}
          min={1}
          max={100}
          step={0.5}
          onChange={(value) => onChange({ width: value })}
        />
        <NumberField
          id="d-shape-h"
          label="Height (%)"
          value={element.height}
          min={1}
          max={100}
          step={0.5}
          onChange={(value) => onChange({ height: value })}
        />
        <NumberField
          id="d-shape-stroke"
          label="Border"
          value={element.strokeWidth}
          min={0}
          max={50}
          step={0.5}
          onChange={(value) => onChange({ strokeWidth: value })}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TicketDesigner() {
  const [layout, setLayout] = useState<DesignElement[]>(defaultLayout);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [pendingBackground, setPendingBackground] = useState<File | null>(null);
  const [clearBackground, setClearBackground] = useState(false);
  const [geometry, setGeometry] = useState<PrintGeometry>(DEFAULT_GEOMETRY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Additional selected elements (ctrl/cmd-click for multi-select). */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");
  const [viewportWidth, setViewportWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Unsaved changes pending — drives the Save button label. */
  const [dirty, setDirty] = useState(false);
  /** Name embedded in exported template files. */
  const [templateName, setTemplateName] = useState("Ticket design");
  const [exportingTemplate, setExportingTemplate] = useState(false);
  const [importingTemplate, setImportingTemplate] = useState(false);

  // Preview data (never saved): what the tokens resolve to on the canvas.
  const [previewValues, setPreviewValues] = useState<PreviewValues>(sampleValues);
  const [stressTest, setStressTest] = useState(false);

  // Measured layout problems (text off the ticket / colliding text).
  const [issues, setIssues] = useState<Record<string, ElementIssue>>({});
  const [fontsTick, setFontsTick] = useState(0);

  // Undo / redo.
  const [historyCounts, setHistoryCounts] = useState({ past: 0, future: 0 });

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const elementRefs = useRef(new Map<string, HTMLDivElement>());
  const issuesRef = useRef<Record<string, ElementIssue>>({});
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const pastRef = useRef<DesignElement[][]>([]);
  const futureRef = useRef<DesignElement[][]>([]);
  const lastSnapRef = useRef<{ key: string; at: number } | null>(null);
  const dragMovedRef = useRef(false);

  // Local preview of a freshly picked background file so the canvas shows it
  // immediately — before anything is saved to the server.  The object URL is
  // created once per file and revoked when it is replaced or on unmount.
  const pendingBackgroundPreview = useMemo(
    () =>
      pendingBackground
        ? { url: URL.createObjectURL(pendingBackground), file: pendingBackground }
        : null,
    [pendingBackground]
  );

  useEffect(() => {
    if (!pendingBackgroundPreview) return;
    return () => URL.revokeObjectURL(pendingBackgroundPreview.url);
  }, [pendingBackgroundPreview]);

  /** What the canvas renders right now: the pending file wins over the saved
   *  one, and a pending removal hides the saved background immediately. */
  const canvasBackgroundUrl =
    pendingBackgroundPreview?.url ?? (clearBackground ? null : backgroundUrl);

  // ---- derived geometry / zoom ------------------------------------------------
  const cell = useMemo(() => ticketCellSizeMm(geometry), [geometry]);
  const fitZoom = clamp(
    viewportWidth > 0 ? (viewportWidth - 56) / cell.widthPx : 1,
    0.25,
    3
  );
  const zoom = zoomMode === "fit" ? fitZoom : Number(zoomMode);
  const canvasWidth = cell.widthPx * zoom;
  const canvasHeight = cell.heightPx * zoom;

  useEffect(() => {
    const node = viewportRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setViewportWidth(node.clientWidth));
    observer.observe(node);
    setViewportWidth(node.clientWidth);
    return () => observer.disconnect();
  }, [loading, loadError]);

  // ---- preview context --------------------------------------------------------
  const previewContext = useMemo(() => {
    const values: PreviewValues = {};
    for (const [key, value] of Object.entries(previewValues)) {
      values[key] = stressTest ? stretchValue(value) : value;
    }
    return { ...(SAMPLE_CONTEXT as object), ...values } as unknown as typeof SAMPLE_CONTEXT;
  }, [previewValues, stressTest]);

  // ---- load ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchTicketDesign();
        if (cancelled) return;
        const savedLayout = normalizeLayout(data.layout);
        setLayout(savedLayout.length > 0 ? savedLayout : defaultLayout());
        setBackgroundUrl(data.background_url);
        setGeometry({
          paperSize: paperSizeFromApi(data.page_size),
          orientation:
            data.page_orientation === "landscape" ? "landscape" : "portrait",
          columns: Math.max(1, data.page_columns),
          rows: Math.max(1, data.page_rows),
          marginMm: Math.max(0, data.margin_mm),
          gapMm: Math.max(0, data.gap_mm),
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof ApiClientError
              ? err.detail ?? "Unable to load the ticket design."
              : "Unable to connect to the server."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Warn before leaving with unsaved work.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Re-measure once web fonts have loaded (they change text widths).
  useEffect(() => {
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } })
      .fonts;
    fonts?.ready.then(() => setFontsTick((tick) => tick + 1)).catch(() => {});
  }, []);

  // ---- selection --------------------------------------------------------------
  const selected = useMemo(
    () => layout.find((element) => element.id === selectedId) ?? null,
    [layout, selectedId]
  );

  /** All selected elements — `selectedId` alone when there is no multi-select. */
  const selection = useMemo(
    () => (selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : []),
    [selectedIds, selectedId]
  );

  /** Ids of selected text elements (text formatting never touches shapes). */
  const selectedTextIds = useMemo(
    () =>
      layout
        .filter((element) => element.type === "text" && selection.includes(element.id))
        .map((element) => element.id),
    [layout, selection]
  );

  /** Select exactly one element (clears any multi-selection). */
  const selectOne = useCallback((id: string | null) => {
    setSelectedId(id);
    setSelectedIds(id ? [id] : []);
  }, []);

  /** Ctrl/cmd toggles an element's membership in the selection. */
  const toggleInSelection = useCallback(
    (id: string) => {
      const ids = selection.includes(id)
        ? selection.filter((item) => item !== id)
        : [...selection, id];
      setSelectedIds(ids);
      setSelectedId(ids.length > 0 ? ids[ids.length - 1] : null);
    },
    [selection]
  );

  // ---- history (undo / redo) ---------------------------------------------------
  // const syncHistoryCounts = () =>
  //   setHistoryCounts({
  //     past: pastRef.current.length,
  //     future: futureRef.current.length,
  //   });

  /**
   * Record the current layout before a change.  Calls sharing a `key` within
   * 800 ms (typing, nudging, dragging a number) collapse into one undo step.
   */
  const snapshot = useCallback((key?: string) => {
    const now = Date.now();
    const last = lastSnapRef.current;
    if (key && last && last.key === key && now - last.at < 800) {
      lastSnapRef.current = { key, at: now };
      return;
    }
    lastSnapRef.current = key ? { key, at: now } : null;
    pastRef.current.push(layoutRef.current);
    if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift();
    futureRef.current = [];
    setHistoryCounts({
      past: pastRef.current.length,
      future: 0,
    });
  }, []);

  const pruneSelection = useCallback((next: DesignElement[]) => {
    const exists = (id: string) => next.some((element) => element.id === id);
    setSelectedIds((prev) => prev.filter(exists));
    setSelectedId((prev) => (prev && exists(prev) ? prev : null));
  }, []);

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(layoutRef.current);
    lastSnapRef.current = null;
    setLayout(previous);
    pruneSelection(previous);
    setDirty(true);
    setHistoryCounts({
      past: pastRef.current.length,
      future: futureRef.current.length,
    });
  }, [pruneSelection]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(layoutRef.current);
    lastSnapRef.current = null;
    setLayout(next);
    pruneSelection(next);
    setDirty(true);
    setHistoryCounts({
      past: pastRef.current.length,
      future: futureRef.current.length,
    });
  }, [pruneSelection]);

  // ---- dragging / rotating --------------------------------------------------
  const handleElementPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, element: DesignElement) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      let ids: string[];
      if (event.ctrlKey || event.metaKey) {
        ids = selection.includes(element.id)
          ? selection.filter((id) => id !== element.id)
          : [...selection, element.id];
        setSelectedIds(ids);
        setSelectedId(ids.length > 0 ? ids[ids.length - 1] : null);
        if (!ids.includes(element.id)) return; // toggled off — not draggable
      } else if (!selection.includes(element.id)) {
        ids = [element.id];
        setSelectedIds(ids);
        setSelectedId(element.id);
      } else {
        ids = selection;
      }
      dragMovedRef.current = false;
      setDrag({
        mode: "move",
        id: element.id,
        startX: event.clientX,
        startY: event.clientY,
        origins: layout
          .filter((item) => ids.includes(item.id))
          .map((item) => ({ id: item.id, x: item.x, y: item.y })),
        cellWidth: rect.width,
        cellHeight: rect.height,
        origRotation: element.rotation,
        centerX: 0,
        centerY: 0,
        startAngle: 0,
      });
    },
    [layout, selection]
  );

  const handleRotatePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, element: DesignElement) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const centerX = rect.left + (element.x / 100) * rect.width;
      const centerY = rect.top + (element.y / 100) * rect.height;
      dragMovedRef.current = false;
      setDrag({
        mode: "rotate",
        id: element.id,
        startX: event.clientX,
        startY: event.clientY,
        origins: [],
        cellWidth: rect.width,
        cellHeight: rect.height,
        origRotation: element.rotation,
        centerX,
        centerY,
        startAngle:
          (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) /
          Math.PI,
      });
    },
    []
  );

  useEffect(() => {
    if (!drag) return;
    const markMoved = () => {
      // One undo step per drag, recorded on the first real movement only.
      if (!dragMovedRef.current) {
        dragMovedRef.current = true;
        snapshot();
      }
    };
    const onMove = (event: PointerEvent) => {
      if (drag.mode === "rotate") {
        markMoved();
        const angle =
          (Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX) *
            180) /
          Math.PI;
        let next = Math.round((drag.origRotation + (angle - drag.startAngle)) * 10) / 10;
        if (next > 180) next -= 360;
        if (next < -180) next += 360;
        // Snap close to straight angles; Shift forces exact 15° steps.
        const snapped = [-180, -90, 0, 90, 180].find(
          (target) => Math.abs(next - target) < 3
        );
        if (snapped !== undefined) next = snapped;
        if (event.shiftKey) next = Math.round(next / 15) * 15;
        setLayout((prev) =>
          prev.map((element) =>
            element.id === drag.id ? { ...element, rotation: next } : element
          )
        );
        setDirty(true);
        return;
      }
      const dxPct = ((event.clientX - drag.startX) / drag.cellWidth) * 100;
      const dyPct = ((event.clientY - drag.startY) / drag.cellHeight) * 100;
      if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) < 2) {
        return; // ignore click jitter
      }
      markMoved();
      setLayout((prev) =>
        prev.map((element) => {
          const origin = drag.origins.find((item) => item.id === element.id);
          if (!origin) return element;
          return {
            ...element,
            x: clamp(origin.x + dxPct, 0, 100),
            y: clamp(origin.y + dyPct, 0, 100),
          };
        })
      );
      setDirty(true);
    };
    const onEnd = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [drag, snapshot]);

  // ---- element operations ---------------------------------------------------
  const addElement = useCallback(
    (text: string) => {
      if (layoutRef.current.length >= MAX_ELEMENTS) {
        toast.error(`A ticket can hold up to ${MAX_ELEMENTS} elements.`);
        return;
      }
      snapshot();
      // Stagger new text so repeated "Add text" clicks don't stack invisibly.
      const textCount = layoutRef.current.filter((item) => item.type === "text").length;
      const element = createElement({
        text,
        x: 50,
        y: clamp(20 + (textCount % 6) * 12, 5, 95),
      });
      setLayout((prev) => [...prev, element]);
      selectOne(element.id);
      setDirty(true);
    },
    [selectOne, snapshot]
  );

  const addShape = useCallback(
    (shape: "rectangle" | "ellipse") => {
      if (layoutRef.current.length >= MAX_ELEMENTS) {
        toast.error(`A ticket can hold up to ${MAX_ELEMENTS} elements.`);
        return;
      }
      snapshot();
      const preset = SHAPE_PRESETS[0];
      const element = createShapeElement(shape, {
        width: 40,
        height: 14,
        fill: preset.fill,
        strokeColor: preset.stroke,
        strokeWidth: 0,
      });
      // New shapes go behind existing content so they never hide text.
      setLayout((prev) => [element, ...prev]);
      selectOne(element.id);
      setDirty(true);
    },
    [selectOne, snapshot]
  );

  /** Patch any element; marks the design dirty until the user saves. */
  const updateElement = useCallback(
    (id: string, patch: Partial<DesignElement>) => {
      snapshot(`u:${id}:${Object.keys(patch).join(",")}`);
      setLayout((prev) =>
        prev.map((element) =>
          element.id === id ? { ...element, ...patch } : element
        )
      );
      setDirty(true);
    },
    [snapshot]
  );

  /** Patch several elements at once (e.g. bold on every selected text). */
  const updateElements = useCallback(
    (ids: string[], patch: Partial<DesignElement>) => {
      if (ids.length === 0) return;
      snapshot(`m:${ids.join("|")}:${Object.keys(patch).join(",")}`);
      setLayout((prev) =>
        prev.map((element) =>
          ids.includes(element.id) ? { ...element, ...patch } : element
        )
      );
      setDirty(true);
    },
    [snapshot]
  );

  /** Apply id→position patches (used by the align tools). */
  const applyPatches = useCallback(
    (patches: { id: string; x?: number; y?: number }[]) => {
      if (patches.length === 0) return;
      snapshot();
      const byId = new Map(patches.map((patch) => [patch.id, patch] as const));
      setLayout((prev) =>
        prev.map((element) => {
          const patch = byId.get(element.id);
          return patch
            ? {
                ...element,
                ...(patch.x !== undefined ? { x: patch.x } : {}),
                ...(patch.y !== undefined ? { y: patch.y } : {}),
              }
            : element;
        })
      );
      setDirty(true);
    },
    [snapshot]
  );

  /** Apply one text-formatting patch to every selected TEXT element. */
  const applyStyle = useCallback(
    (patch: Partial<DesignElement>) => updateElements(selectedTextIds, patch),
    [selectedTextIds, updateElements]
  );

  /** Delete the selection if `id` is part of it, otherwise just `id`. */
  const deleteElement = useCallback(
    (id: string) => {
      const ids = selection.includes(id) ? selection : [id];
      snapshot();
      setLayout((prev) => prev.filter((element) => !ids.includes(element.id)));
      setSelectedIds((prev) => prev.filter((item) => !ids.includes(item)));
      setSelectedId((prev) => (prev !== null && ids.includes(prev) ? null : prev));
      setDirty(true);
    },
    [selection, snapshot]
  );

  /** Duplicate the selection (or just `id`), offset slightly, and select copies. */
  const duplicateElements = useCallback(
    (ids: string[]) => {
      const sources = layoutRef.current.filter((element) => ids.includes(element.id));
      if (sources.length === 0) return;
      if (layoutRef.current.length + sources.length > MAX_ELEMENTS) {
        toast.error(`A ticket can hold up to ${MAX_ELEMENTS} elements.`);
        return;
      }
      snapshot();
      const copies = sources.map((element) =>
        createElement({
          ...element,
          id: newElementId(),
          x: clamp(element.x + 2, 0, 100),
          y: clamp(element.y + 2, 0, 100),
        })
      );
      setLayout((prev) => [...prev, ...copies]);
      setSelectedIds(copies.map((copy) => copy.id));
      setSelectedId(copies[copies.length - 1].id);
      setDirty(true);
    },
    [snapshot]
  );

  const duplicateSelection = useCallback(
    () => duplicateElements(selection),
    [duplicateElements, selection]
  );

  const deleteSelection = useCallback(() => {
    if (selection.length === 0) return;
    snapshot();
    setLayout((prev) => prev.filter((element) => !selection.includes(element.id)));
    setSelectedIds([]);
    setSelectedId(null);
    setDirty(true);
  }, [selection, snapshot]);

  /**
   * Change drawing order. The layout array is drawn first→last, so a HIGHER
   * index is in FRONT: +1 brings forward, -1 sends backward.
   */
  const moveLayer = useCallback(
    (id: string, direction: 1 | -1) => {
      const current = layoutRef.current;
      const index = current.findIndex((element) => element.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return;
      snapshot();
      setLayout((prev) => {
        const next = [...prev];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      });
      setDirty(true);
    },
    [snapshot]
  );

  /** Align all selected elements (2+ required; centers are the element anchors). */
  const alignSelection = useCallback(
    (mode: AlignMode) => {
      const targets = layout.filter((element) => selection.includes(element.id));
      applyPatches(alignElements(targets, mode));
    },
    [applyPatches, layout, selection]
  );

  /** Rotate every selected element by a relative number of degrees. */
  const rotateSelection = useCallback(
    (delta: number) => {
      if (selection.length === 0) return;
      snapshot();
      setLayout((prev) =>
        prev.map((element) => {
          if (!selection.includes(element.id)) return element;
          let next = element.rotation + delta;
          if (next > 180) next -= 360;
          if (next < -180) next += 360;
          return { ...element, rotation: Math.round(next * 10) / 10 };
        })
      );
      setDirty(true);
    },
    [selection, snapshot]
  );

  /** Toggle one text style on the whole text selection. */
  const toggleFormat = useCallback(
    (key: "bold" | "italic" | "underline" | "uppercase") => {
      if (!selected || selected.type !== "text") return;
      applyStyle({ [key]: !selected[key] } as Partial<DesignElement>);
    },
    [applyStyle, selected]
  );

  const resetTemplate = () => {
    snapshot();
    setLayout(defaultLayout());
    selectOne(null);
    setDirty(true);
    toast.info("Template reset — press Undo to bring your design back.");
  };

  /**
   * Shrink a text element's font so it fits inside the ticket, based on how
   * much room it has around its center.
   */
  const autoFitElement = useCallback(
    (id: string) => {
      const element = layoutRef.current.find((item) => item.id === id);
      const node = elementRefs.current.get(id);
      const canvas = canvasRef.current;
      if (!element || element.type !== "text" || !node || !canvas) return;
      const c = canvas.getBoundingClientRect();
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const availW = 2 * Math.min(cx - c.left, c.right - cx) - 6;
      const availH = 2 * Math.min(cy - c.top, c.bottom - cy) - 6;
      if (availW <= 0 || availH <= 0) {
        toast.info("Move this text away from the ticket edge, then auto-fit it.");
        return;
      }
      const scale = Math.min(1, availW / r.width, availH / r.height);
      if (scale >= 1) return;
      updateElement(id, {
        fontSize: Math.max(0.5, Math.round(element.fontSize * scale * 0.97 * 10) / 10),
      });
    },
    [updateElement]
  );

  // ---- overflow / collision detection ---------------------------------------
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const c = canvas.getBoundingClientRect();
      if (!c.width || !c.height) return;
      const TOL = 1;
      const boxes: { id: string; r: DOMRect }[] = [];
      const next: Record<string, ElementIssue> = {};

      for (const element of layout) {
        if (element.type !== "text") continue;
        const node = elementRefs.current.get(element.id);
        if (!node) continue;
        if (!resolveTokens(element.text, previewContext).trim()) continue;
        const r = node.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        boxes.push({ id: element.id, r });
        if (
          r.left < c.left - TOL ||
          r.top < c.top - TOL ||
          r.right > c.right + TOL ||
          r.bottom > c.bottom + TOL
        ) {
          next[element.id] = { outside: true, overlaps: [] };
        }
      }

      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i].r;
          const b = boxes[j].r;
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w <= 0 || h <= 0) continue;
          const smaller = Math.min(a.width * a.height, b.width * b.height);
          if ((w * h) / smaller < 0.05) continue; // ignore grazing contact
          const ai = (next[boxes[i].id] ??= { outside: false, overlaps: [] });
          const bj = (next[boxes[j].id] ??= { outside: false, overlaps: [] });
          ai.overlaps.push(boxes[j].id);
          bj.overlaps.push(boxes[i].id);
        }
      }

      if (JSON.stringify(next) !== JSON.stringify(issuesRef.current)) {
        issuesRef.current = next;
        setIssues(next);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [layout, previewContext, canvasWidth, canvasHeight, fontsTick, loading]);

  const issueList = useMemo(
    () =>
      layout.filter((element) => issues[element.id]).map((element) => ({
        element,
        issue: issues[element.id],
      })),
    [layout, issues]
  );

  // ---- token insertion ------------------------------------------------------
  const insertTokenIntoSelected = (token: string) => {
    if (!selected || selected.type !== "text") {
      addElement(token);
      return;
    }
    const area = textAreaRef.current;
    const start = area?.selectionStart ?? selected.text.length;
    const end = area?.selectionEnd ?? start;
    const next = selected.text.slice(0, start) + token + selected.text.slice(end);
    updateElement(selected.id, { text: next });
    const caret = start + token.length;
    requestAnimationFrame(() => {
      if (area) {
        area.focus();
        area.setSelectionRange(caret, caret);
      }
    });
  };

  // ---- background -----------------------------------------------------------
  const handleBackgroundChange = (file: File | null) => {
    if (!file) return;
    const okType =
      ["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      /\.(png|jpe?g|webp)$/i.test(file.name);
    if (!okType) {
      toast.error("Use a PNG or JPG image for the ticket background.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Background image must be 10 MB or smaller.");
      return;
    }
    setPendingBackground(file);
    setClearBackground(false);
    setDirty(true);

    // The image is stretched to fill one ticket, so warn if its proportions
    // differ from the ticket cell (it would look squashed when printed).
    const probeUrl = URL.createObjectURL(file);
    const probe = new window.Image();
    probe.onload = () => {
      const imageRatio = probe.naturalWidth / probe.naturalHeight;
      const ticketRatio = cell.widthMm / cell.heightMm;
      if (Math.abs(imageRatio - ticketRatio) / ticketRatio > 0.03) {
        toast.warning(
          `This image is not the same shape as the ticket (${cell.widthMm.toFixed(
            1
          )} × ${cell.heightMm.toFixed(1)} mm) and will look stretched. Check the size guide.`
        );
      }
      URL.revokeObjectURL(probeUrl);
    };
    probe.onerror = () => URL.revokeObjectURL(probeUrl);
    probe.src = probeUrl;
  };

  const removeBackground = () => {
    setPendingBackground(null);
    setClearBackground(true);
    setDirty(true);
  };

  // ---- template import / export ---------------------------------------------
  /**
   * Download the current design as a self-contained template file: layout,
   * sheet setup and the effective background (pending upload wins, a pending
   * removal means no background, otherwise the saved image is fetched and
   * embedded).  Everything currently on the canvas is what gets exported.
   */
  const handleExportTemplate = async () => {
    setExportingTemplate(true);
    try {
      let background: TemplateBackgroundPayload | null = null;
      if (pendingBackground) {
        background = await backgroundPayloadFromFile(pendingBackground);
      } else if (!clearBackground && backgroundUrl) {
        try {
          background = await backgroundPayloadFromUrl(backgroundUrl);
        } catch {
          toast.info(
            "The background image could not be read — exporting the design without it."
          );
        }
      }
      const json = buildTemplateJson({ name: templateName, layout, geometry, background });
      downloadTextFile(templateFileName(templateName), json);
      toast.success("Template exported — share the downloaded file.");
    } catch {
      toast.error("Unable to export the template.");
    } finally {
      setExportingTemplate(false);
    }
  };

  /**
   * Load a shared template file into the designer as pending changes: the
   * layout and (validated) sheet setup are applied at once, the embedded
   * background — if any — flows through the normal save pipeline.  Nothing is
   * persisted until the user presses "Save design".
   */
  const handleImportTemplate = async (file: File | null) => {
    if (!file) return;
    setImportingTemplate(true);
    try {
      const parsed = parseTemplateJson(await file.text());
      snapshot();
      setLayout(parsed.layout);
      if (parsed.geometry) {
        setGeometry(parsed.geometry);
      } else {
        toast.info(
          "The template's sheet setup does not fit its paper — your current one was kept."
        );
      }
      if (parsed.background) {
        setPendingBackground(parsed.background);
        setClearBackground(false);
      } else {
        setPendingBackground(null);
        setClearBackground(true);
      }
      selectOne(null);
      setDirty(true);
      toast.success(
        `Template “${parsed.name}” loaded — review it and press “Save design”.`
      );
    } catch (err) {
      toast.error(
        err instanceof TemplateError
          ? err.message
          : "Unable to read the template file."
      );
    } finally {
      setImportingTemplate(false);
    }
  };

  // ---- save -------------------------------------------------------------------
  const handleSave = async () => {
    if (saving) return;
    const geometryError = validateGeometry(geometry);
    if (geometryError) {
      toast.error(geometryError);
      return;
    }
    setSaving(true);
    try {
      const payload = await saveTicketDesign({
        layout,
        pageSize: paperSizeToApi(geometry.paperSize),
        orientation: geometry.orientation,
        columns: geometry.columns,
        rows: geometry.rows,
        marginMm: geometry.marginMm,
        gapMm: geometry.gapMm,
        backgroundFile: pendingBackground,
        clearBackground,
      });
      setBackgroundUrl(payload.background_url);
      // Re-normalize from the server's cleaned response: the canvas then shows
      // exactly what was persisted (any field the backend dropped would be
      // visible immediately instead of appearing after a reload).
      const savedLayout = normalizeLayout(payload.layout);
      if (savedLayout.length > 0) setLayout(savedLayout);
      setPendingBackground(null);
      setClearBackground(false);
      setGeometry((prev) => ({
        ...prev,
        columns: Math.max(1, payload.page_columns),
        rows: Math.max(1, payload.page_rows),
        marginMm: Math.max(0, payload.margin_mm),
        gapMm: Math.max(0, payload.gap_mm),
        paperSize: paperSizeFromApi(payload.page_size),
        orientation:
          payload.page_orientation === "landscape" ? "landscape" : "portrait",
      }));
      setDirty(false);
      toast.success("Ticket design saved.");
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.detail ?? "Unable to save the ticket design."
          : "Unable to connect to the server."
      );
    } finally {
      setSaving(false);
    }
  };

  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;

  // ---- keyboard ---------------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      // Save works from anywhere, including inside form fields.
      if (mod && key === "s") {
        event.preventDefault();
        void saveRef.current();
        return;
      }
      if (isEditableTarget(event.target as HTMLElement | null)) return;

      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && key === "d") {
        event.preventDefault();
        duplicateSelection();
        return;
      }
      if (event.key === "Escape") {
        selectOne(null);
        return;
      }
      if (selection.length === 0) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelection();
        return;
      }
      const step = event.shiftKey ? 2 : 0.5;
      let dx = 0;
      let dy = 0;
      if (event.key === "ArrowLeft") dx = -step;
      else if (event.key === "ArrowRight") dx = step;
      else if (event.key === "ArrowUp") dy = -step;
      else if (event.key === "ArrowDown") dy = step;
      else return;
      event.preventDefault();
      snapshot("nudge");
      setLayout((prev) =>
        prev.map((element) =>
          selection.includes(element.id)
            ? {
                ...element,
                x: clamp(element.x + dx, 0, 100),
                y: clamp(element.y + dy, 0, 100),
              }
            : element
        )
      );
      setDirty(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection, deleteSelection, duplicateSelection, redo, undo, selectOne, snapshot]);

  // ---- render -----------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading designer…
      </div>
    );
  }

  if (loadError) {
    return (
      <Card className="mx-auto mt-16 max-w-md">
        <CardContent className="space-y-4 p-6 text-center">
          <h2 className="text-lg font-semibold">Designer unavailable</h2>
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  const selectedIndex = selected
    ? layout.findIndex((element) => element.id === selected.id)
    : -1;
  const selectedIssue = selected ? issues[selected.id] : undefined;
  const previewKeys = Object.keys(previewValues);
  /** Layers panel lists front-most first, like a design tool. */
  const layers = [...layout].reverse();

  return (
    <div className="space-y-4">
      {/* ---- Header ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ticket Designer</h1>
          <p className="text-sm text-muted-foreground">
            Arrange the ticket contents, format the text, and set the background
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
          <Button
            variant="outline"
            size="icon"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            disabled={historyCounts.past === 0}
            onClick={undo}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            disabled={historyCounts.future === 0}
            onClick={redo}
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button asChild variant="outline">
            <Link to="/print">Open Print Center</Link>
          </Button>
          <Button variant="outline" onClick={resetTemplate}>
            <RotateCcw className="h-4 w-4" />
            Reset template
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saving ? "Saving…" : dirty ? "Save design" : "Saved"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_300px]">
        {/* ---- Left: contents / preview data / background / setup ---- */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Contents</CardTitle>
              <CardDescription>
                Add text or a data field, then drag it on the ticket.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => addElement("New text")}
                >
                  <Plus className="h-4 w-4" />
                  Add text
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => addElement("{number}")}
                >
                  <Type className="h-4 w-4" />
                  Ticket no.
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => addShape("rectangle")}
                >
                  <Square className="h-4 w-4" />
                  Rectangle
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => addShape("ellipse")}
                >
                  <Circle className="h-4 w-4" />
                  Ellipse
                </Button>
              </div>

              <div className="space-y-1">
                <SectionTitle>Data fields</SectionTitle>
                <div className="flex flex-wrap gap-1">
                  {TOKENS.map((token) => (
                    <button
                      key={token.token}
                      type="button"
                      className="rounded border border-input px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-accent"
                      onClick={() => addElement(token.token)}
                      title={`Add ${token.label} to the ticket`}
                    >
                      {token.label}
                    </button>
                  ))}
                </div>
              </div>

              <Separator />
              <SectionTitle
                aside={
                  <span className="text-[10px] text-muted-foreground">
                    front → back
                  </span>
                }
              >
                Layers ({layout.length})
              </SectionTitle>
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {layers.map((element, listIndex) => {
                  const index = layout.length - 1 - listIndex;
                  const isShape = element.type === "shape";
                  const name = isShape
                    ? element.shape === "ellipse"
                      ? "Ellipse"
                      : "Rectangle"
                    : element.text || "(empty)";
                  const KindIcon = isShape
                    ? element.shape === "ellipse"
                      ? Circle
                      : Square
                    : Type;
                  const hasIssue = Boolean(issues[element.id]);
                  return (
                    <div
                      key={element.id}
                      className={cn(
                        "flex items-center gap-1 rounded border px-2 py-1.5 text-xs",
                        selection.includes(element.id)
                          ? "border-primary bg-primary/5"
                          : "bg-muted/30"
                      )}
                    >
                      <KindIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <button
                        type="button"
                        className="flex-1 truncate text-left"
                        title={name}
                        onClick={(event) => {
                          if (event.ctrlKey || event.metaKey) {
                            toggleInSelection(element.id);
                          } else {
                            selectOne(element.id);
                          }
                        }}
                      >
                        {name}
                      </button>
                      {hasIssue && (
                        <AlertTriangle
                          className="h-3 w-3 shrink-0 text-amber-500"
                          aria-label="Needs attention"
                        />
                      )}
                      <button
                        type="button"
                        aria-label="Bring forward"
                        title="Bring forward"
                        className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
                        disabled={index === layout.length - 1}
                        onClick={() => moveLayer(element.id, 1)}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="Send backward"
                        title="Send backward"
                        className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
                        disabled={index === 0}
                        onClick={() => moveLayer(element.id, -1)}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete"
                        title="Delete"
                        className="rounded p-0.5 text-destructive hover:bg-destructive/10"
                        onClick={() => deleteElement(element.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
                {layout.length === 0 && (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    Nothing on the ticket yet — add text or a shape above.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Preview data</CardTitle>
              <CardDescription>
                See the ticket with realistic values. This is only a preview — it is
                never saved or printed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-xs">
                <button
                  type="button"
                  aria-pressed={!stressTest}
                  className={cn(
                    "rounded px-2 py-1.5 font-medium",
                    !stressTest ? "bg-background shadow-sm" : "text-muted-foreground"
                  )}
                  onClick={() => setStressTest(false)}
                >
                  Typical values
                </button>
                <button
                  type="button"
                  aria-pressed={stressTest}
                  className={cn(
                    "rounded px-2 py-1.5 font-medium",
                    stressTest ? "bg-background shadow-sm" : "text-muted-foreground"
                  )}
                  onClick={() => setStressTest(true)}
                >
                  Long values
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {stressTest
                  ? "Every value is doubled in length so you can check long names and addresses still fit."
                  : "Edit the values below to match your real data."}
              </p>
              {previewKeys.length > 0 && (
                <div className="space-y-2">
                  {previewKeys.map((key) => (
                    <div key={key} className="space-y-1">
                      <Label htmlFor={`d-preview-${key}`} className="text-xs">
                        {tokenLabel(key)}
                      </Label>
                      <Input
                        id={`d-preview-${key}`}
                        className="h-8 text-xs"
                        maxLength={120}
                        value={previewValues[key]}
                        onChange={(event) =>
                          setPreviewValues((prev) => ({
                            ...prev,
                            [key]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setPreviewValues(sampleValues())}
                  >
                    Restore sample values
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Background</CardTitle>
              <CardDescription>
                Upload a JPG/PNG designed at the exact size guide — it fills one
                ticket completely.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {pendingBackgroundPreview ? (
                <div className="flex items-center gap-3">
                  <img
                    src={pendingBackgroundPreview.url}
                    alt="New ticket background"
                    className="h-16 w-16 rounded border object-cover"
                  />
                  <div className="flex-1 space-y-1 text-xs text-muted-foreground">
                    <p className="truncate font-medium text-foreground">
                      {pendingBackgroundPreview.file.name}
                    </p>
                    <p>Will be uploaded when you save.</p>
                  </div>
                </div>
              ) : backgroundUrl && !clearBackground ? (
                <div className="flex items-center gap-3">
                  <img
                    src={backgroundUrl}
                    alt="Ticket background"
                    className="h-16 w-16 rounded border object-cover"
                  />
                  <div className="flex-1 space-y-1 text-xs text-muted-foreground">
                    <p>Current background</p>
                    <Button variant="outline" size="sm" onClick={removeBackground}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ImageIcon className="h-4 w-4" />
                  {clearBackground && backgroundUrl
                    ? "Background will be removed when you save."
                    : "No background image yet."}
                </p>
              )}
              <input
                id={BACKGROUND_INPUT_ID}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  handleBackgroundChange(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => document.getElementById(BACKGROUND_INPUT_ID)?.click()}
              >
                <ImageIcon className="h-4 w-4" />
                {canvasBackgroundUrl ? "Replace image" : "Upload image"}
              </Button>
            </CardContent>
          </Card>

          <CollapsibleCard
            title="Sheet setup"
            description="Paper, columns and margins. Saved with the design."
          >
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="d-paper" className="text-xs">
                  Paper
                </Label>
                <Select
                  value={geometry.paperSize}
                  onValueChange={(value) =>
                    setGeometry((prev) => ({
                      ...prev,
                      paperSize: value as PrintGeometry["paperSize"],
                    }))
                  }
                >
                  <SelectTrigger id="d-paper" className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A4">A4</SelectItem>
                    <SelectItem value="Letter">Letter</SelectItem>
                    <SelectItem value="Legal">Legal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="d-orient" className="text-xs">
                  Orientation
                </Label>
                <Select
                  value={geometry.orientation}
                  onValueChange={(value) =>
                    setGeometry((prev) => ({
                      ...prev,
                      orientation: value as PrintGeometry["orientation"],
                    }))
                  }
                >
                  <SelectTrigger id="d-orient" className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait">Portrait</SelectItem>
                    <SelectItem value="landscape">Landscape</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <NumberField
                id="d-cols"
                label="Columns"
                value={geometry.columns}
                min={1}
                max={MAX_COLUMNS}
                onChange={(value) => {
                  setGeometry((prev) => ({ ...prev, columns: Math.round(value) }));
                  setDirty(true);
                }}
              />
              <NumberField
                id="d-rows"
                label="Rows"
                value={geometry.rows}
                min={1}
                max={MAX_ROWS}
                onChange={(value) => {
                  setGeometry((prev) => ({ ...prev, rows: Math.round(value) }));
                  setDirty(true);
                }}
              />
              <NumberField
                id="d-margin"
                label="Margin (mm)"
                value={geometry.marginMm}
                min={0}
                max={60}
                onChange={(value) => {
                  setGeometry((prev) => ({ ...prev, marginMm: Math.round(value) }));
                  setDirty(true);
                }}
              />
              <NumberField
                id="d-gap"
                label="Gap (mm)"
                value={geometry.gapMm}
                min={0}
                max={50}
                onChange={(value) => {
                  setGeometry((prev) => ({ ...prev, gapMm: Math.round(value) }));
                  setDirty(true);
                }}
              />
            </div>
            <SizeGuide geometry={geometry} />
          </CollapsibleCard>

          <CollapsibleCard
            title="Share as template"
            description="Export or import a design file (layout, sheet setup, background)."
          >
            <div className="space-y-1">
              <Label htmlFor="d-template-name" className="text-xs">
                Template name
              </Label>
              <Input
                id="d-template-name"
                className="h-8 text-xs"
                maxLength={80}
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={exportingTemplate}
                onClick={() => void handleExportTemplate()}
              >
                {exportingTemplate ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="h-4 w-4" />
                )}
                Export
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={importingTemplate}
                onClick={() => document.getElementById(TEMPLATE_INPUT_ID)?.click()}
              >
                {importingTemplate ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="h-4 w-4" />
                )}
                Import
              </Button>
            </div>
            <input
              id={TEMPLATE_INPUT_ID}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                void handleImportTemplate(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Importing replaces the designer contents (you can undo it); nothing is
              saved until you press “Save design”.
            </p>
          </CollapsibleCard>
        </div>

        {/* ---- Center: ticket canvas ---- */}
        <div className="min-w-0">
          <Card className="flex h-full flex-col">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Ticket canvas</CardTitle>
                  <CardDescription>
                    One ticket at{" "}
                    <span className="tabular-nums">
                      {cell.widthMm.toFixed(1)} × {cell.heightMm.toFixed(1)} mm
                    </span>{" "}
                    — drag text to arrange it.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="d-zoom" className="text-xs">
                    Zoom
                  </Label>
                  <Select
                    value={zoomMode}
                    onValueChange={(value) => setZoomMode(value as ZoomMode)}
                  >
                    <SelectTrigger id="d-zoom" className="h-8 w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fit">Fit</SelectItem>
                      {(["0.5", "0.75", "1", "1.5", "2"] as const).map((value) => (
                        <SelectItem key={value} value={value}>
                          {Math.round(Number(value) * 100)}%
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-1 border-y bg-muted/20 px-3 py-2">
              <span className="mr-1 text-[11px] font-medium text-muted-foreground">
                {selection.length === 0
                  ? "Click an element to select it"
                  : selection.length === 1
                    ? selected?.type === "shape"
                      ? "Shape selected"
                      : "Text selected"
                    : `${selection.length} elements selected`}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                title="Rotate selection -90°"
                disabled={selection.length === 0}
                onClick={() => rotateSelection(-90)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                90°
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                title="Rotate selection +90°"
                disabled={selection.length === 0}
                onClick={() => rotateSelection(90)}
              >
                <RotateCw className="h-3.5 w-3.5" />
                90°
              </Button>
              <Separator orientation="vertical" className="mx-1 h-6" />
              {ALIGN_ACTIONS.map((action) => {
                const AlignIcon = action.icon;
                return (
                  <Button
                    key={action.mode}
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    title={
                      selection.length < 2
                        ? `${action.title} (select 2 or more)`
                        : action.title
                    }
                    aria-label={action.title}
                    disabled={selection.length < 2}
                    onClick={() => alignSelection(action.mode)}
                  >
                    <AlignIcon className="h-3.5 w-3.5" />
                  </Button>
                );
              })}
              <Separator orientation="vertical" className="mx-1 h-6" />
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                title="Duplicate selection (Ctrl+D)"
                disabled={selection.length === 0}
                onClick={duplicateSelection}
              >
                <Copy className="h-3.5 w-3.5" />
                Duplicate
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-destructive hover:text-destructive"
                title="Delete selection"
                disabled={selection.length === 0}
                onClick={deleteSelection}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>

            {/* Layout health: shown only when something needs attention */}
            {issueList.length > 0 && (
              <div
                role="status"
                className="space-y-1 border-b border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
              >
                <div className="flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {issueList.length === 1
                    ? "1 element needs attention with this data"
                    : `${issueList.length} elements need attention with this data`}
                </div>
                <ul className="space-y-0.5">
                  {issueList.slice(0, 4).map(({ element, issue }) => (
                    <li key={element.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        className="max-w-[16rem] truncate text-left underline-offset-2 hover:underline"
                        onClick={() => selectOne(element.id)}
                      >
                        {element.type === "text" ? element.text || "(empty)" : "Shape"}
                      </button>
                      <span className="text-amber-800/80 dark:text-amber-200/80">
                        {[
                          issue.outside ? "runs off the ticket" : null,
                          issue.overlaps.length > 0
                            ? `overlaps ${issue.overlaps.length} other${
                                issue.overlaps.length > 1 ? "s" : ""
                              }`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                      {issue.outside && (
                        <button
                          type="button"
                          className="ml-auto inline-flex items-center gap-1 rounded border border-amber-400/70 px-1.5 py-0.5 font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40"
                          onClick={() => autoFitElement(element.id)}
                        >
                          <Wand2 className="h-3 w-3" />
                          Auto-fit
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {issueList.length > 4 && (
                  <p className="text-amber-800/80 dark:text-amber-200/80">
                    +{issueList.length - 4} more — look for dashed red outlines on the
                    canvas.
                  </p>
                )}
              </div>
            )}

            <div
              ref={viewportRef}
              className="flex flex-1 items-start justify-center overflow-auto bg-muted/30 p-6"
            >
              <div
                ref={canvasRef}
                className="relative shrink-0 overflow-hidden border-2 border-border bg-white shadow-inner"
                style={{ width: canvasWidth, height: canvasHeight }}
                onPointerDown={() => selectOne(null)}
              >
                {canvasBackgroundUrl && (
                  <img
                    src={canvasBackgroundUrl}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    className="pointer-events-none absolute inset-0 h-full w-full select-none"
                    style={{ objectFit: "fill" }}
                  />
                )}
                {layout.length === 0 && !canvasBackgroundUrl && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                    Add text to start designing.
                  </div>
                )}
                {layout.map((element) => {
                  const isSelected = selection.includes(element.id);
                  const hasIssue = Boolean(issues[element.id]);
                  return (
                    <div
                      key={element.id}
                      ref={(node) => {
                        if (node) elementRefs.current.set(element.id, node);
                        else elementRefs.current.delete(element.id);
                      }}
                      onPointerDown={(event) =>
                        handleElementPointerDown(event, element)
                      }
                      className={cn(
                        "select-none",
                        isSelected &&
                          "outline outline-2 outline-primary -outline-offset-2",
                        !isSelected &&
                          hasIssue &&
                          "outline outline-1 outline-dashed outline-red-500 -outline-offset-1",
                        drag?.id === element.id ? "cursor-grabbing" : "cursor-grab"
                      )}
                      style={{
                        ...elementStyle(element, canvasHeight),
                        touchAction: "none",
                      }}
                    >
                      {element.type === "shape"
                        ? null
                        : resolveTokens(element.text, previewContext)}
                      {selectedId === element.id && (
                        <button
                          type="button"
                          aria-label="Rotate element"
                          title="Drag to rotate; hold Shift for 15° steps"
                          onPointerDown={(event) =>
                            handleRotatePointerDown(event, element)
                          }
                          className="absolute -top-7 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-primary bg-white text-primary shadow"
                          style={{ touchAction: "none" }}
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        </div>

        {/* ---- Right: properties ---- */}
        <div className="self-start xl:sticky xl:top-4">
          <Card className="xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {selected
                  ? selected.type === "shape"
                    ? "Shape properties"
                    : "Text properties"
                  : "Properties"}
              </CardTitle>
              <CardDescription>
                {selected
                  ? selection.length > 1
                    ? `${selection.length} selected — text styling applies to all selected text.`
                    : "Format and position the selected element."
                  : "Select an element on the canvas to edit it."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {selected ? (
                <>
                  {selectedIssue && selected.type === "text" && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <div className="space-y-1">
                        <p>
                          {selectedIssue.outside
                            ? "With the current preview data this text runs off the ticket."
                            : "This text overlaps another text element."}
                        </p>
                        {selectedIssue.outside && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => autoFitElement(selected.id)}
                          >
                            <Wand2 className="h-3.5 w-3.5" />
                            Auto-fit text
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* -- Text content + token insertion -- */}
                  {selected.type === "text" && (
                    <div className="space-y-2">
                      <SectionTitle>Content</SectionTitle>
                      <Label htmlFor="d-text" className="sr-only">
                        Text
                      </Label>
                      <Textarea
                        id="d-text"
                        ref={textAreaRef}
                        value={selected.text}
                        maxLength={500}
                        onChange={(event) =>
                          updateElement(selected.id, { text: event.target.value })
                        }
                        placeholder="Type text, or insert a field below"
                        className="min-h-[80px] text-xs font-mono"
                      />
                      <div className="space-y-1">
                        <span className="text-[11px] text-muted-foreground">
                          Insert a field at the cursor:
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {TOKENS.map((token) => (
                            <button
                              key={token.token}
                              type="button"
                              className="rounded border border-input px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-accent"
                              onClick={() => insertTokenIntoSelected(token.token)}
                              title={token.label}
                            >
                              {token.token}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* -- Text style -- */}
                  {selected.type === "text" && (
                    <div className="space-y-3">
                      <SectionTitle
                        aside={
                          selectedTextIds.length > 1 ? (
                            <span className="text-[10px] text-muted-foreground">
                              applies to {selectedTextIds.length} texts
                            </span>
                          ) : undefined
                        }
                      >
                        Style
                      </SectionTitle>

                      <div className="flex flex-wrap items-center gap-1">
                        <ToggleButton
                          active={selected.bold}
                          title="Bold"
                          onClick={() => toggleFormat("bold")}
                        >
                          <Bold className="h-4 w-4" />
                        </ToggleButton>
                        <ToggleButton
                          active={selected.italic}
                          title="Italic"
                          onClick={() => toggleFormat("italic")}
                        >
                          <Italic className="h-4 w-4" />
                        </ToggleButton>
                        <ToggleButton
                          active={selected.underline}
                          title="Underline"
                          onClick={() => toggleFormat("underline")}
                        >
                          <Underline className="h-4 w-4" />
                        </ToggleButton>
                        <ToggleButton
                          active={selected.uppercase}
                          title="Uppercase"
                          onClick={() => toggleFormat("uppercase")}
                        >
                          <CaseUpper className="h-4 w-4" />
                        </ToggleButton>
                        <Separator orientation="vertical" className="mx-1 h-5" />
                        {(
                          [
                            { value: "left", title: "Align left", icon: AlignLeft },
                            { value: "center", title: "Align center", icon: AlignCenter },
                            { value: "right", title: "Align right", icon: AlignRight },
                          ] as const
                        ).map((option) => {
                          const Icon = option.icon;
                          return (
                            <ToggleButton
                              key={option.value}
                              active={selected.align === option.value}
                              title={option.title}
                              onClick={() => applyStyle({ align: option.value })}
                            >
                              <Icon className="h-4 w-4" />
                            </ToggleButton>
                          );
                        })}
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor="d-fontFamily" className="text-xs">
                          Font family
                        </Label>
                        <Select
                          value={selected.fontFamily}
                          onValueChange={(value) => applyStyle({ fontFamily: value })}
                        >
                          <SelectTrigger id="d-fontFamily" className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FONT_FAMILIES.map((font) => (
                              <SelectItem
                                key={font.value}
                                value={font.value}
                                style={{ fontFamily: font.value }}
                              >
                                {font.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <NumberField
                          id="d-fontSize"
                          label="Font size (%)"
                          value={selected.fontSize}
                          min={0.5}
                          max={100}
                          step={0.5}
                          onChange={(value) => applyStyle({ fontSize: value })}
                        />
                        <NumberField
                          id="d-lineHeight"
                          label="Line height"
                          value={selected.lineHeight}
                          min={0.5}
                          max={4}
                          step={0.1}
                          onChange={(value) => applyStyle({ lineHeight: value })}
                        />
                      </div>

                      <ColorField
                        label="Text color"
                        value={selected.color}
                        onChange={(value) => applyStyle({ color: value })}
                      />
                    </div>
                  )}

                  {/* -- Shape style -- */}
                  {selected.type === "shape" && (
                    <ShapeInspector
                      element={selected}
                      onChange={(patch) => updateElement(selected.id, patch)}
                    />
                  )}

                  {/* -- Arrange: position, rotation, layer -- */}
                  <div className="space-y-3">
                    <SectionTitle
                      aside={
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          X {selected.x.toFixed(1)} / Y {selected.y.toFixed(1)}
                        </span>
                      }
                    >
                      Position (center %)
                    </SectionTitle>
                    <div className="grid grid-cols-3 gap-2">
                      <NumberField
                        id="d-x"
                        label="Horizontal"
                        value={selected.x}
                        min={0}
                        max={100}
                        step={0.5}
                        onChange={(value) => updateElement(selected.id, { x: value })}
                      />
                      <NumberField
                        id="d-y"
                        label="Vertical"
                        value={selected.y}
                        min={0}
                        max={100}
                        step={0.5}
                        onChange={(value) => updateElement(selected.id, { y: value })}
                      />
                      <NumberField
                        id="d-rotation"
                        label="Rotation (°)"
                        value={selected.rotation}
                        min={-180}
                        max={180}
                        step={1}
                        onChange={(value) =>
                          updateElement(selected.id, { rotation: value })
                        }
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => moveLayer(selected.id, 1)}
                        disabled={selectedIndex === layout.length - 1}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                        Forward
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => moveLayer(selected.id, -1)}
                        disabled={selectedIndex === 0}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                        Backward
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => duplicateElements(selection)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Duplicate
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-destructive hover:text-destructive"
                        onClick={() => deleteElement(selected.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    Pick something on the ticket or in the Layers list to change its
                    content, style and position.
                  </p>
                  <div className="space-y-1.5">
                    <SectionTitle>Shortcuts</SectionTitle>
                    <dl className="space-y-1 text-xs">
                      {SHORTCUTS.map(([keys, action]) => (
                        <div key={keys} className="flex justify-between gap-3">
                          <dt className="font-medium">{keys}</dt>
                          <dd className="text-right text-muted-foreground">{action}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}