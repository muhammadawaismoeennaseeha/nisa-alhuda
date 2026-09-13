"use client";

/**
 * The confirmation dialog the structure editor destroys things through.
 *
 * Two modes:
 *   - confirm (default) — Cancel plus a destructive action button.
 *   - `blocked` — no action button at all. Used where the safe answer isn't
 *     "are you sure?" but "not from here": deleting a subject whose classes
 *     carry recordings would cascade them away in one click, so that path is
 *     closed and the dialog explains the way round it.
 */
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function CourseConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel = "Delete",
  onConfirm,
  busy = false,
  blocked = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  onConfirm?: () => void;
  busy?: boolean;
  blocked?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No corner X: the footer already carries the only two ways out, and a
          second dismiss control reads as a third option on a destructive ask. */}
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-2 space-y-3 text-sm text-muted-foreground">
          {children}
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {blocked ? "Close" : "Cancel"}
          </Button>
          {!blocked && (
            <Button variant="destructive" onClick={onConfirm} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {confirmLabel}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
