/**
 * Ticket Designer — a small studio for laying out the printable ticket.
 *
 * The canvas shows ONE ticket at its exact cell size (from the sheet setup).
 * Text elements can be dragged, rotated, nudged with the arrow keys and
 * formatted (bold / italic / underline / uppercase, font family, size, color,
 * alignment, line height).  Shapes (rectangle / ellipse) can be added with
 * configurable fill / stroke colors and sizes.  Several elements can be
 * selected (ctrl/cmd-click) and aligned or moved together.  Text supports
 * tokens such as {number}, {customer} and {date}.  The background image
 * (JPG/PNG sized to the single-ticket guide) fills the ticket when printed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
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
  CaseUpper,
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

const BACKGROUND_INPUT_ID = "ticket-background-input";
const TEMPLATE_INPUT_ID = "ticket-template-input";

/** Quick fill/border presets for new shapes. */
const SHAPE_PRESETS = [
  { fill: "#2563eb", stroke: "#1e3a8a" },
  { fill: "#f59e0b", stroke: "#b45309" },
  { fill: "#10b981", stroke: "#047857" },
  { fill: "#ef4444", stroke: "#b91c1c" },
];

/** Swatch palette offered for shape colors. */
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

/**
 * Shape properties: kind, size (in % of the ticket), fill, outline and the
 * shared rotation control.  Positions are edited with the shared Position block
 * below, so only shape-specific fields live here.
 */
function ShapeInspector({
  element,
  onChange,
}: {
  element: DesignElement;
  onChange: (patch: Partial<DesignElement>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Shape
      </div>

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

      <SwatchRow
        label="Fill color"
        value={element.fill}
        onChange={(value) => onChange({ fill: value })}
      />

      <SwatchRow
        label="Border color"
        value={element.strokeColor}
        onChange={(value) => onChange({ strokeColor: value })}
      />

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="d-shape-w" className="text-xs">
            Width (%)
          </Label>
          <Input
            id="d-shape-w"
            type="number"
            min={1}
            max={100}
            step={0.5}
            className="h-8"
            value={element.width}
            onChange={(event) =>
              onChange({
                width: clamp(parseFloat(event.target.value) || 1, 1, 100),
              })
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="d-shape-h" className="text-xs">
            Height (%)
          </Label>
          <Input
            id="d-shape-h"
            type="number"
            min={1}
            max={100}
            step={0.5}
            className="h-8"
            value={element.height}
            onChange={(event) =>
              onChange({
                height: clamp(parseFloat(event.target.value) || 1, 1, 100),
              })
            }
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="d-shape-stroke" className="text-xs">
          Border width (%)
        </Label>
        <Input
          id="d-shape-stroke"
          type="number"
          min={0}
          max={5}
          step={0.1}
          className="h-8"
          value={element.strokeWidth}
          onChange={(event) =>
            onChange({
              strokeWidth: clamp(parseFloat(event.target.value) || 0, 0, 5),
            })
          }
        />
      </div>
    </div>
  );
}

/**
 * Colour control used by the shape inspector: a native picker, a hex field and
 * the shared swatch palette.  Every change is applied immediately (live) so the
 * canvas previews the colour as the user picks it.
 */
function SwatchRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          aria-label={`${label} picker`}
          className="h-8 w-12 cursor-pointer p-0"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <Input
          type="text"
          aria-label={`${label} hex value`}
          className="h-8 font-mono text-xs"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
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
    </div>
  );
}

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
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Unsaved changes pending — drives the Save button label. */
  const [dirty, setDirty] = useState(false);
  /** In-progress colour value from the pickers, committed on blur. */
  const [colorDraft, setColorDraft] = useState<string | null>(null);
  /** Name embedded in exported template files. */
  const [templateName, setTemplateName] = useState("Ticket design");
  const [exportingTemplate, setExportingTemplate] = useState(false);
  const [importingTemplate, setImportingTemplate] = useState(false);

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

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

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

  const selected = useMemo(
    () => layout.find((element) => element.id === selectedId) ?? null,
    [layout, selectedId]
  );

  /** All selected elements — `selectedId` alone when there is no multi-select. */
  const selection = useMemo(
    () => (selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : []),
    [selectedIds, selectedId]
  );

  /** Select exactly one element (clears any multi-selection). */
  const selectOne = useCallback((id: string | null) => {
    setSelectedId(id);
    setSelectedIds([]);
  }, []);

  // Reset the color draft whenever the selection changes.
  useEffect(() => {
    setColorDraft(null);
  }, [selectedId]);

  // ---- dragging / rotating --------------------------------------------------
  const handleElementPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, element: DesignElement) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      // Ctrl/cmd-click toggles membership in the multi-selection.
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
    const onMove = (event: PointerEvent) => {
      if (drag.mode === "rotate") {
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
  }, [drag]);

  // ---- element operations ---------------------------------------------------
  const addElement = useCallback((text: string) => {
    const element = createElement({ text });
    setLayout((prev) => [...prev, element]);
    setSelectedId(element.id);
    setDirty(true);
  }, []);

  const addShape = useCallback((shape: "rectangle" | "ellipse") => {
    const preset = SHAPE_PRESETS[0];
    const element = createShapeElement(shape, {
      width: 40,
      height: 14,
      fill: preset.fill,
      strokeColor: preset.stroke,
      strokeWidth: 0,
    });
    setLayout((prev) => [...prev, element]);
    setSelectedId(element.id);
    setDirty(true);
  }, []);

  /** Patch any element; marks the design dirty until the user saves. */
  const updateElement = useCallback(
    (id: string, patch: Partial<DesignElement>) => {
      setLayout((prev) =>
        prev.map((element) =>
          element.id === id ? { ...element, ...patch } : element
        )
      );
      setDirty(true);
    },
    []
  );

  /** Patch every element in a multi-selection at once (e.g. align, bold). */
  const updateElements = useCallback(
    (ids: string[], patch: Partial<DesignElement>) => {
      if (ids.length === 0) return;
      setLayout((prev) =>
        prev.map((element) =>
          ids.includes(element.id) ? { ...element, ...patch } : element
        )
      );
      setDirty(true);
    },
    []
  );

  /** Apply id→patch pairs (used by the align tools). */
  const applyPatches = useCallback(
    (patches: { id: string; x?: number; y?: number }[]) => {
      if (patches.length === 0) return;
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
    []
  );

  /** Apply one formatting patch to every element in the selection. */
  const patchSelection = useCallback(
    (patch: Partial<DesignElement>) => updateElements(selection, patch),
    [selection, updateElements]
  );

  const deleteElement = useCallback(
    (id: string) => {
      const ids = selection.includes(id) ? selection : [id];
      setLayout((prev) => prev.filter((element) => !ids.includes(element.id)));
      setSelectedIds([]);
      setSelectedId((prev) => (prev !== null && ids.includes(prev) ? null : prev));
      setDirty(true);
    },
    [selection]
  );

  const duplicateElement = useCallback(
    (id: string) => {
      const ids = selection.includes(id) ? selection : [id];
      setLayout((prev) => {
        const copies = prev
          .filter((element) => ids.includes(element.id))
          .map((element) =>
            createElement({
              ...element,
              id: newElementId(),
              x: clamp(element.x + 2, 0, 100),
              y: clamp(element.y + 2, 0, 100),
            })
          );
        if (copies.length === 0) return prev;
        setSelectedId(copies[copies.length - 1].id);
        return [...prev, ...copies];
      });
      setDirty(true);
    },
    [selection]
  );

  const moveLayer = useCallback((id: string, direction: 1 | -1) => {
    setLayout((prev) => {
      const index = prev.findIndex((element) => element.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
  }, []);

  /** Duplicate every selected element, offset slightly, and select the copies. */
  const duplicateSelection = useCallback(() => {
    if (selection.length === 0) return;
    const copies = layout
      .filter((element) => selection.includes(element.id))
      .map((element) =>
        createElement({
          ...element,
          id: newElementId(),
          x: clamp(element.x + 2, 0, 100),
          y: clamp(element.y + 2, 0, 100),
        })
      );
    setLayout((prev) => [...prev, ...copies]);
    setSelectedIds(copies.map((copy) => copy.id));
    setSelectedId(copies.length > 0 ? copies[copies.length - 1].id : null);
    setDirty(true);
  }, [layout, selection]);

  const deleteSelection = useCallback(() => {
    if (selection.length === 0) return;
    setLayout((prev) => prev.filter((element) => !selection.includes(element.id)));
    setSelectedIds([]);
    setSelectedId(null);
    setDirty(true);
  }, [selection]);

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
    [selection]
  );

  /**
   * Toggle one text style (bold/italic/underline/uppercase) on the whole
   * selection, so several text elements can be styled at once.
   */
  const toggleFormat = useCallback(
    (key: "bold" | "italic" | "underline" | "uppercase") => {
      if (!selected) return;
      const patch: Partial<DesignElement> =
        key === "bold"
          ? { bold: !selected.bold }
          : key === "italic"
            ? { italic: !selected.italic }
            : key === "underline"
              ? { underline: !selected.underline }
              : { uppercase: !selected.uppercase };
      patchSelection(patch);
    },
    [patchSelection, selected]
  );

  /** Apply any text patch (font, size, colour, alignment) to the selection. */
  const applyStyle = useCallback(
    (patch: Partial<DesignElement>) => {
      if (!selected) return;
      patchSelection(patch);
    },
    [patchSelection, selected]
  );

  const resetTemplate = () => {
    setLayout(defaultLayout());
    setSelectedId(null);
    setSelectedIds([]);
    setDirty(true);
  };

  // ---- keyboard: nudge + delete --------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!selectedId) return;
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
  }, [selectedId, selection, deleteSelection]);

  // ---- token insertion ------------------------------------------------------
  const insertTokenIntoSelected = (token: string) => {
    if (!selected) {
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
  };

  const removeBackground = () => {
    setPendingBackground(null);
    setClearBackground(true);
    setBackgroundUrl(null);
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

  // ---- render -----------------------------------------------------------------
  const cell = ticketCellSizeMm(geometry);
  const canvasWidth = cell.widthPx * zoom;
  const canvasHeight = cell.heightPx * zoom;

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ticket Designer</h1>
          <p className="text-sm text-muted-foreground">
            Arrange the ticket contents, format the text, and set the background
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link to="/print">Open Print Center</Link>
          </Button>
          <Button variant="outline" onClick={resetTemplate}>
            <Redo2 className="h-4 w-4" />
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
        {/* ---- Left: contents / tokens / background ---- */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Contents</CardTitle>
              <CardDescription>
                Add text, then drag it on the ticket.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
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
              <Separator className="my-2" />
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Elements ({layout.length})
              </div>
              <div className="max-h-44 space-y-1 overflow-y-auto">
                {layout.map((element, index) => (
                  <div
                    key={element.id}
                    className={cn(
                      "flex items-center gap-1 rounded border px-2 py-1.5 text-xs",
                      selectedId === element.id
                        ? "border-primary bg-primary/5"
                        : "bg-muted/30"
                    )}
                  >
                    <button
                      type="button"
                      className="flex-1 truncate text-left"
                      onClick={() => {
                        setSelectedId(element.id);
                        setSelectedIds([element.id]);
                      }}
                      title={
                        element.type === "shape"
                          ? element.shape === "ellipse"
                            ? "Ellipse"
                            : "Rectangle"
                          : element.text
                      }
                    >
                      {element.type === "shape"
                        ? element.shape === "ellipse"
                          ? "Ellipse"
                          : "Rectangle"
                        : element.text || "(empty)"}
                    </button>
                    <button
                      type="button"
                      aria-label="Move up"
                      className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
                      disabled={index === 0}
                      onClick={() => moveLayer(element.id, -1)}
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
                      disabled={index === layout.length - 1}
                      onClick={() => moveLayer(element.id, 1)}
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete"
                      className="rounded p-0.5 text-destructive hover:bg-destructive/10"
                      onClick={() => deleteElement(element.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {layout.length === 0 && (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    No elements yet — add one above.
                  </p>
                )}
              </div>
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
              {backgroundUrl ? (
                <div className="flex items-center gap-3">
                  <img
                    src={backgroundUrl}
                    alt="Ticket background"
                    className="h-16 w-16 rounded border object-cover"
                  />
                  <div className="flex-1 space-y-1 text-xs text-muted-foreground">
                    <p>Current background</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={removeBackground}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              ) : pendingBackgroundPreview ? (
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
              ) : (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ImageIcon className="h-4 w-4" />
                  No background image yet.
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
                onClick={() =>
                  document.getElementById(BACKGROUND_INPUT_ID)?.click()
                }
              >
                <ImageIcon className="h-4 w-4" />
                {backgroundUrl || pendingBackground
                  ? "Replace image"
                  : "Upload image"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Sheet setup</CardTitle>
              <CardDescription>
                Saved with the design; also the Print Center defaults.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
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
                <div className="space-y-1">
                  <Label htmlFor="d-cols" className="text-xs">
                    Columns
                  </Label>
                  <Input
                    id="d-cols"
                    type="number"
                    min={1}
                    max={MAX_COLUMNS}
                    className="h-8"
                    value={geometry.columns}
                    onChange={(event) =>
                      setGeometry((prev) => ({
                        ...prev,
                        columns: Math.max(
                          1,
                          Math.min(
                            MAX_COLUMNS,
                            parseInt(event.target.value, 10) || 1
                          )
                        ),
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="d-rows" className="text-xs">
                    Rows
                  </Label>
                  <Input
                    id="d-rows"
                    type="number"
                    min={1}
                    max={MAX_ROWS}
                    className="h-8"
                    value={geometry.rows}
                    onChange={(event) =>
                      setGeometry((prev) => ({
                        ...prev,
                        rows: Math.max(
                          1,
                          Math.min(MAX_ROWS, parseInt(event.target.value, 10) || 1)
                        ),
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="d-margin" className="text-xs">
                    Margin (mm)
                  </Label>
                  <Input
                    id="d-margin"
                    type="number"
                    min={0}
                    max={60}
                    className="h-8"
                    value={geometry.marginMm}
                    onChange={(event) =>
                      setGeometry((prev) => ({
                        ...prev,
                        marginMm: Math.max(
                          0,
                          parseInt(event.target.value, 10) || 0
                        ),
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="d-gap" className="text-xs">
                    Gap (mm)
                  </Label>
                  <Input
                    id="d-gap"
                    type="number"
                    min={0}
                    max={50}
                    className="h-8"
                    value={geometry.gapMm}
                    onChange={(event) =>
                      setGeometry((prev) => ({
                        ...prev,
                        gapMm: Math.max(0, parseInt(event.target.value, 10) || 0),
                      }))
                    }
                  />
                </div>
              </div>
              <SizeGuide geometry={geometry} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Share as template</CardTitle>
              <CardDescription>
                Export this design (layout, sheet setup and background) to a
                file anyone can import into their Ticket Designer.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
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
                Importing replaces the designer contents; nothing is saved until
                you press “Save design”.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ---- Center: ticket canvas ---- */}
        <div>
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
                    value={String(zoom)}
                    onValueChange={(value) => setZoom(Number(value))}
                  >
                    <SelectTrigger id="d-zoom" className="h-8 w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[0.5, 0.75, 1, 1.5, 2].map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {Math.round(value * 100)}%
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
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
                    title={action.title}
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
                title="Duplicate selection"
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
            <CardContent className="flex flex-1 items-start justify-center overflow-auto bg-muted/30 p-6">
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
                {layout.map((element) => (
                  <div
                    key={element.id}
                    onPointerDown={(event) =>
                      handleElementPointerDown(event, element)
                    }
                    className={cn(
                      "select-none",
                      selection.includes(element.id) &&
                        "outline-2 outline-primary -outline-offset-2",
                      drag?.id === element.id ? "cursor-grabbing" : "cursor-grab"
                    )}
                    style={{
                      ...elementStyle(element, canvasHeight),
                      touchAction: "none",
                    }}
                  >
                    {element.type === "shape"
                      ? null
                      : resolveTokens(element.text, SAMPLE_CONTEXT)}
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
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        {/* ---- Right: formatting properties (when element selected) ---- */}
        <div>
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {selected ? "Element properties" : "No element selected"}
              </CardTitle>
              <CardDescription>
                {selected
                  ? "Format and position the selected text on the ticket."
                  : "Select a text element on the canvas to edit it."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selected ? (
                <>

                  {/* -- Shape style -- */}
                  {selected.type === "shape" && (
                    <ShapeInspector
                      element={selected}
                      onChange={(patch) => updateElement(selected.id, patch)}
                    />
                  )}

                  {/* -- Text content + token insertion -- */}
                  {selected.type === "text" && (
                    <div className="space-y-2">
                      <Label htmlFor="d-text" className="text-xs">
                        Text
                      </Label>
                      <Textarea
                        id="d-text"
                        ref={textAreaRef}
                        value={selected.text}
                        onChange={(event) =>
                          updateElement(selected.id, {
                            text: event.target.value,
                          })
                        }
                        placeholder="Type {number} {customer}"
                        className="min-h-[80px] text-xs font-mono"
                      />
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
                  )}

                  {/* -- Formatting toggles -- */}
                  {selected.type === "text" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Formatting
                        </div>
                        {selection.length > 1 && (
                          <span className="text-[10px] text-muted-foreground">
                            applies to {selection.length} selected
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          title="Bold"
                          className={cn(
                            "rounded p-1.5 hover:bg-accent",
                            selected.bold && "bg-accent text-primary"
                          )}
                          onClick={() => toggleFormat("bold")}
                        >
                          <Bold className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="Italic"
                          className={cn(
                            "rounded p-1.5 hover:bg-accent",
                            selected.italic && "bg-accent text-primary"
                          )}
                          onClick={() => toggleFormat("italic")}
                        >
                          <Italic className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="Underline"
                          className={cn(
                            "rounded p-1.5 hover:bg-accent",
                            selected.underline && "bg-accent text-primary"
                          )}
                          onClick={() => toggleFormat("underline")}
                        >
                          <Underline className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="Uppercase"
                          className={cn(
                            "rounded p-1.5 hover:bg-accent",
                            selected.uppercase && "bg-accent text-primary"
                          )}
                          onClick={() => toggleFormat("uppercase")}
                        >
                          <CaseUpper className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* -- Font family + size (text only) -- */}
                  {selected.type === "text" && (
                    <div className="space-y-3">
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
                        <div className="space-y-1">
                          <Label htmlFor="d-fontSize" className="text-xs">
                            Font size (%)
                          </Label>
                          <Input
                            id="d-fontSize"
                            type="number"
                            min={0.5}
                            max={100}
                            step={0.5}
                            className="h-8"
                            value={selected.fontSize}
                            onChange={(event) =>
                              applyStyle({
                                fontSize: clamp(
                                  parseFloat(event.target.value) || 0.5,
                                  0.5,
                                  100
                                ),
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="d-lineHeight" className="text-xs">
                            Line height
                          </Label>
                          <Input
                            id="d-lineHeight"
                            type="number"
                            min={0.5}
                            max={4}
                            step={0.1}
                            className="h-8"
                            value={selected.lineHeight}
                            onChange={(event) =>
                              applyStyle({
                                lineHeight: clamp(
                                  parseFloat(event.target.value) || 1.2,
                                  0.5,
                                  4
                                ),
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* -- Text color (text only) -- */}
                  {selected.type === "text" && (
                    <div className="space-y-1">
                      <Label htmlFor="d-color" className="text-xs">
                        Text color
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="d-color"
                          type="color"
                          className="h-8 w-12 cursor-pointer p-0"
                          value={selected.color}
                          onChange={(event) => setColorDraft(event.target.value)}
                          onBlur={() => {
                            if (colorDraft) {
                              applyStyle({ color: colorDraft });
                              setColorDraft(null);
                            }
                          }}
                        />
                        <Input
                          type="text"
                          className="h-8 font-mono text-xs"
                          value={colorDraft ?? selected.color}
                          onChange={(event) => setColorDraft(event.target.value)}
                          onBlur={() => {
                            if (colorDraft) {
                              applyStyle({ color: colorDraft });
                              setColorDraft(null);
                            }
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* -- Text alignment within its box (text only) -- */}
                  {selected.type === "text" && (
                    <div className="space-y-1">
                      <Label className="text-xs">Text alignment</Label>
                      <div className="flex gap-1">
                        {(
                          [
                            { value: "left", title: "Left", icon: AlignLeft },
                            { value: "center", title: "Center", icon: AlignCenter },
                            { value: "right", title: "Right", icon: AlignRight },
                          ] as const
                        ).map((option) => {
                          const Icon = option.icon;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              title={option.title}
                              className={cn(
                                "rounded p-1.5 hover:bg-accent",
                                selected.align === option.value &&
                                  "bg-accent text-primary"
                              )}
                              onClick={() => applyStyle({ align: option.value })}
                            >
                              <Icon className="h-4 w-4" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* -- Font family + size (text only) -- */}
                  {selected.type === "text" && (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label htmlFor="d-fontFamily" className="text-xs">
                          Font family
                        </Label>
                        <Select
                          value={selected.fontFamily}
                          onValueChange={(value) =>
                            applyStyle({ fontFamily: value })
                          }
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
                        <div className="space-y-1">
                          <Label htmlFor="d-fontSize" className="text-xs">
                            Font size (%)
                          </Label>
                          <Input
                            id="d-fontSize"
                            type="number"
                            min={0.5}
                            max={100}
                            step={0.5}
                            className="h-8"
                            value={selected.fontSize}
                            onChange={(event) =>
                              applyStyle({
                                fontSize: clamp(
                                  parseFloat(event.target.value) || 0.5,
                                  0.5,
                                  100
                                ),
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="d-lineHeight" className="text-xs">
                            Line height
                          </Label>
                          <Input
                            id="d-lineHeight"
                            type="number"
                            min={0.5}
                            max={4}
                            step={0.1}
                            className="h-8"
                            value={selected.lineHeight}
                            onChange={(event) =>
                              applyStyle({
                                lineHeight: clamp(
                                  parseFloat(event.target.value) || 1.2,
                                  0.5,
                                  4
                                ),
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* -- Text color + in-box alignment (text only) -- */}
                  {selected.type === "text" && (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label htmlFor="d-color" className="text-xs">
                          Text color
                        </Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="d-color"
                            type="color"
                            className="h-8 w-12 cursor-pointer p-0"
                            value={selected.color}
                            onChange={(event) => setColorDraft(event.target.value)}
                            onBlur={() => {
                              if (colorDraft) {
                                applyStyle({ color: colorDraft });
                                setColorDraft(null);
                              }
                            }}
                          />
                          <Input
                            type="text"
                            aria-label="Text color hex value"
                            className="h-8 font-mono text-xs"
                            value={colorDraft ?? selected.color}
                            onChange={(event) => setColorDraft(event.target.value)}
                            onBlur={() => {
                              if (colorDraft) {
                                applyStyle({ color: colorDraft });
                                setColorDraft(null);
                              }
                            }}
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Text alignment</Label>
                        <div className="flex gap-1">
                          {(
                            [
                              { value: "left", title: "Left", icon: AlignLeft },
                              { value: "center", title: "Center", icon: AlignCenter },
                              { value: "right", title: "Right", icon: AlignRight },
                            ] as const
                          ).map((option) => {
                            const Icon = option.icon;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                title={option.title}
                                className={cn(
                                  "rounded p-1.5 hover:bg-accent",
                                  selected.align === option.value &&
                                    "bg-accent text-primary"
                                )}
                                onClick={() => applyStyle({ align: option.value })}
                              >
                                <Icon className="h-4 w-4" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}


                  {/* -- Rotation (text and shapes) -- */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="d-rotation" className="text-xs">
                        Rotation (°)
                      </Label>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          title="Rotate -15°"
                          className="rounded p-1 hover:bg-accent"
                          onClick={() => rotateSelection(-15)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Rotate +15°"
                          className="rounded p-1 hover:bg-accent"
                          onClick={() => rotateSelection(15)}
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <Input
                      id="d-rotation"
                      type="number"
                      min={-180}
                      max={180}
                      step={1}
                      className="h-8"
                      value={selected.rotation}
                      onChange={(event) => {
                        const value = parseFloat(event.target.value);
                        updateElement(selected.id, {
                          rotation: clamp(
                            Number.isFinite(value) ? value : 0,
                            -180,
                            180
                          ),
                        });
                      }}
                    />
                  </div>

                  {/* -- Shape appearance (shape only) -- */}
                  {selected.type === "shape" && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {selected.shape === "ellipse" ? "Ellipse" : "Rectangle"}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {SHAPE_PRESETS.map((preset) => (
                            <button
                              key={preset.fill}
                              type="button"
                              title={`Fill ${preset.fill}`}
                              className="h-6 w-6 rounded border border-border"
                              style={{ backgroundColor: preset.fill }}
                              onClick={() =>
                                updateElement(selected.id, {
                                  fill: preset.fill,
                                  strokeColor: preset.stroke,
                                })
                              }
                            />
                          ))}
                        </div>
                      </div>
                      <SwatchRow
                        label="Fill"
                        value={selected.fill}
                        onChange={(value) =>
                          updateElement(selected.id, { fill: value })
                        }
                      />
                      <SwatchRow
                        label="Border color"
                        value={selected.strokeColor}
                        onChange={(value) =>
                          updateElement(selected.id, { strokeColor: value })
                        }
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label htmlFor="d-strokeWidth" className="text-xs">
                            Border (px)
                          </Label>
                          <Input
                            id="d-strokeWidth"
                            type="number"
                            min={0}
                            max={50}
                            step={0.5}
                            className="h-8"
                            value={selected.strokeWidth}
                            onChange={(event) =>
                              updateElement(selected.id, {
                                strokeWidth: clamp(
                                  parseFloat(event.target.value) || 0,
                                  0,
                                  50
                                ),
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="d-shapeWidth" className="text-xs">
                            Width (%)
                          </Label>
                          <Input
                            id="d-shapeWidth"
                            type="number"
                            min={1}
                            max={100}
                            step={1}
                            className="h-8"
                            value={selected.width}
                            onChange={(event) =>
                              updateElement(selected.id, {
                                width: clamp(
                                  parseFloat(event.target.value) || 1,
                                  1,
                                  100
                                ),
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="d-shapeHeight" className="text-xs">
                            Height (%)
                          </Label>
                          <Input
                            id="d-shapeHeight"
                            type="number"
                            min={1}
                            max={100}
                            step={1}
                            className="h-8"
                            value={selected.height}
                            onChange={(event) =>
                              updateElement(selected.id, {
                                height: clamp(
                                  parseFloat(event.target.value) || 1,
                                  1,
                                  100
                                ),
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* -- Position (center-based, in %) -- */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Position (center %)</Label>
                      <span className="text-[10px] text-muted-foreground">
                        X {selected.x.toFixed(1)} / Y {selected.y.toFixed(1)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="d-x" className="text-xs">
                          Horizontal
                        </Label>
                        <Input
                          id="d-x"
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          className="h-8"
                          value={selected.x}
                          onChange={(event) =>
                            updateElement(selected.id, {
                              x: clamp(
                                parseFloat(event.target.value) || 0,
                                0,
                                100
                              ),
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="d-y" className="text-xs">
                          Vertical
                        </Label>
                        <Input
                          id="d-y"
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          className="h-8"
                          value={selected.y}
                          onChange={(event) =>
                            updateElement(selected.id, {
                              y: clamp(
                                parseFloat(event.target.value) || 0,
                                0,
                                100
                              ),
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  {/* -- Layer + actions -- */}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => moveLayer(selected.id, -1)}
                      disabled={
                        layout.findIndex((e) => e.id === selected.id) === 0
                      }
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                      Forward
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => moveLayer(selected.id, 1)}
                      disabled={
                        layout.findIndex(
                          (e) => e.id === selected.id
                        ) ===
                        layout.length - 1
                      }
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
                      onClick={() => duplicateElement(selected.id)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Duplicate
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => deleteElement(selected.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Select a text element on the canvas to edit its content
                  and formatting.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
