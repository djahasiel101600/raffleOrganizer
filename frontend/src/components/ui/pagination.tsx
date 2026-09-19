import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems === 0) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(totalItems, page * pageSize);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-between gap-3 sm:flex-row",
        className
      )}
    >
      <div className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{first}</span> –{" "}
        <span className="font-medium text-foreground">{last}</span> of{" "}
        <span className="font-medium text-foreground">{totalItems}</span> results
      </div>

      {totalPages > 1 && (
        <div className="flex items-center space-x-1">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          {pagesAround(page, totalPages).map((p) => (
            <Button
              key={p}
              variant={p === page ? "default" : "outline"}
              size="sm"
              className="min-w-9"
              onClick={() => onPageChange(p)}
            >
              {p}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

function pagesAround(page: number, total: number): number[] {
  const pages = new Set<number>();
  for (let p = page - 1; p <= page + 1; p += 1) {
    if (p >= 1 && p <= total) pages.add(p);
  }
  if (page === 1) pages.add(2);
  if (page === total && total > 2) pages.add(total - 1);
  return [...pages].sort((a, b) => a - b);
}