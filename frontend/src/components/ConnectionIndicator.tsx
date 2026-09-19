import { cn } from "@/lib/utils";
import {
  connectionLabel,
  type SocketStatus,
} from "@/services/websocket";

export function ConnectionIndicator({
  status,
  className,
}: {
  status: SocketStatus;
  className?: string;
}) {
  const connected = status === "connected";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        connected
          ? "border-success/30 bg-success/10 text-success"
          : "border-warning/30 bg-warning/10 text-warning",
        className
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          connected ? "bg-success" : "animate-pulse bg-warning"
        )}
      />
      {connectionLabel(status)}
    </span>
  );
}