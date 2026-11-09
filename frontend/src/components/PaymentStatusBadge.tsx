import type { PaymentStatus } from "@/types";
import { Badge } from "./ui/badge";

export function PaymentStatusBadge({
  status,
}: {
  status: PaymentStatus;
}) {
  let variant: "success" | "warning" | "secondary" | "destructive" =
    "secondary";
  switch (status) {
    case "paid":
      variant = "success";
      break;
    case "partially_paid":
      variant = "warning";
      break;
    case "cancelled":
      variant = "destructive";
      break;
    case "unpaid":
      variant = "secondary";
      break;
  }
  return (
    <Badge variant={variant} className="capitalize">
      {status.replace("_", " ")}
    </Badge>
  );
}