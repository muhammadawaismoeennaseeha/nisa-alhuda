/**
 * Delete Offering Button — with confirmation dialog.
 * Client Component: handles Supabase delete mutation.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

interface DeleteOfferingProps {
  offeringId: string;
  offeringTitle: string;
  /**
   * Overrides the icon-only trigger. The course workspace header needs a
   * labelled button in the mockup's button style, and re-implementing the
   * confirm dialog there would mean two delete paths to keep in step.
   */
  triggerClassName?: string;
  triggerLabel?: React.ReactNode;
  /**
   * Where to go once the offering is gone. The list can just refresh; a page
   * scoped to this offering would 404 on itself, so it passes a destination.
   */
  redirectTo?: string;
}

export function DeleteOffering({
  offeringId,
  offeringTitle,
  triggerClassName,
  triggerLabel,
  redirectTo,
}: DeleteOfferingProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);

    try {
      const supabase = createClient();

      // Delete offering (cascades to subjects, lessons, resources, chat_rooms)
      const { error } = await supabase
        .from("offerings")
        .delete()
        .eq("id", offeringId);

      if (error) throw new Error(error.message);

      toast.success("Offering deleted.");
      setOpen(false);
      if (redirectTo) router.replace(redirectTo);
      else router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to delete offering."
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={
          triggerClassName ??
          "inline-flex shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 h-7 gap-1 px-2.5 text-[0.8rem] font-medium transition-all"
        }
      >
        {triggerLabel ?? <Trash2 className="h-3.5 w-3.5" />}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Offering</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>&ldquo;{offeringTitle}&rdquo;</strong>?
            This will also delete all associated subjects, lessons, and resources.
            This action cannot be undone.
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
