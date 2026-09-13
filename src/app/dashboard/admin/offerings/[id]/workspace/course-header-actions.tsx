"use client";

/**
 * The Edit / Archive / Delete row in the course workspace header.
 *
 * Split out of `course-workspace` because it owns the header's writes: Edit
 * switches to the Details tab (the offering form, in-page), and the rest of
 * the screen is a projection of the page's SELECTs. Archive flips
 * `offerings.status`, exactly as the offerings list's
 * archive control does; Delete reuses that list's `DeleteOffering` — same
 * confirmation copy, same mutation — rather than growing a second delete path.
 *
 * Nothing here touches lessons, and in particular nothing touches
 * `recording_url`.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ExternalLink, Loader2, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  courseButton,
  courseButtonDanger,
} from "@/components/course/course-surface";
import { DeleteOffering } from "../../delete-offering";
import type { Offering } from "@/lib/types/database";

export function CourseHeaderActions({
  offering,
  onEdit,
}: {
  offering: Pick<Offering, "id" | "title" | "slug" | "status">;
  /** Opens the workspace's Details tab — editing no longer leaves the page. */
  onEdit: () => void;
}) {
  const router = useRouter();
  const [archiving, setArchiving] = useState(false);
  const isArchived = offering.status === "archived";

  async function toggleArchive() {
    setArchiving(true);
    try {
      const supabase = createClient();
      // Un-feature on the way out, mirroring the offerings list: an archived
      // course must not keep a slot on the homepage.
      const update = isArchived
        ? { status: "published" }
        : { status: "archived", is_featured: false };

      const { error } = await supabase
        .from("offerings")
        .update(update)
        .eq("id", offering.id);

      if (error) throw error;
      toast.success(isArchived ? "Offering restored" : "Offering archived");
      router.refresh();
    } catch {
      toast.error("Failed to update.");
    } finally {
      setArchiving(false);
    }
  }

  return (
    <>
      <Link href={`/offerings/${offering.slug}`} className={courseButton}>
        <ExternalLink className="h-4 w-4" />
        View
      </Link>

      <button
        type="button"
        onClick={onEdit}
        className={cn(courseButton, "cursor-pointer")}
      >
        <Pencil className="h-4 w-4" />
        Edit
      </button>

      <button
        type="button"
        onClick={toggleArchive}
        disabled={archiving}
        className={cn(courseButton, "cursor-pointer")}
      >
        {archiving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isArchived ? (
          <RotateCcw className="h-4 w-4" />
        ) : (
          <Archive className="h-4 w-4" />
        )}
        {isArchived ? "Restore" : "Archive"}
      </button>

      <DeleteOffering
        offeringId={offering.id}
        offeringTitle={offering.title}
        redirectTo="/dashboard/admin/offerings"
        triggerClassName={cn(courseButton, courseButtonDanger, "cursor-pointer")}
        triggerLabel={
          <>
            <Trash2 className="h-4 w-4" />
            Delete
          </>
        }
      />
    </>
  );
}
