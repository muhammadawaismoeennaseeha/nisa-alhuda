"use client";

/**
 * The "Teaching Assistants" panel on a course's People tab (admin only).
 *
 * Shows who currently assists this course and lets an admin add or remove one.
 * A TA is a scoped instructor: once assigned here, they can run this course's
 * teaching (attendance, quizzes, grades, roster) but nothing financial, and
 * only on the courses in this list. Assigning is additive; removing deletes
 * only the assignment — it never touches the course, its lessons, or its
 * recordings.
 *
 * The picker only lists people who already hold the `ta` role. If nobody does,
 * it says so and points at the Users page, because that is where the role is
 * granted — this screen decides *which courses*, not *who is a TA*.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserCog, UserPlus, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  courseCard,
  courseButton,
  courseButtonPrimary,
  courseIconButton,
} from "@/components/course/course-surface";
import { assignTA, removeTA } from "./ta-actions";

export interface TAPerson {
  id: string;
  full_name: string | null;
}

interface TeachingAssistantsProps {
  offeringId: string;
  /** People already assigned to this course. */
  assistants: TAPerson[];
  /** Everyone who holds the `ta` role, minus those already assigned. */
  candidates: TAPerson[];
}

export function TeachingAssistants({
  offeringId,
  assistants,
  candidates,
}: TeachingAssistantsProps) {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  async function handleAssign() {
    if (!selected) {
      toast.error("Pick a Teaching Assistant to add.");
      return;
    }
    setAssigning(true);
    const res = await assignTA(offeringId, selected);
    setAssigning(false);
    if (!res.success) {
      toast.error(res.error || "Couldn't assign that person.");
      return;
    }
    toast.success("Teaching Assistant added.");
    setSelected("");
    router.refresh();
  }

  async function handleRemove(person: TAPerson) {
    setBusyId(person.id);
    const res = await removeTA(offeringId, person.id);
    setBusyId(null);
    if (!res.success) {
      toast.error(res.error || "Couldn't remove that person.");
      return;
    }
    toast.success(`${person.full_name || "Teaching Assistant"} removed.`);
    router.refresh();
  }

  return (
    <div className={cn(courseCard, "p-5 sm:px-[22px]")}>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300">
          <UserCog className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-plum-body dark:text-foreground">
            Teaching Assistants
          </h3>
          <p className="text-xs text-muted-foreground">
            Assistants can run this course&apos;s teaching — attendance, quizzes,
            grades — but never see fees or payments.
          </p>
        </div>
      </div>

      {/* Current assistants */}
      <div className="mt-4 space-y-2">
        {assistants.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-soft px-3 py-4 text-center text-xs text-muted-foreground dark:border-border">
            No Teaching Assistants on this course yet.
          </p>
        ) : (
          assistants.map((person) => (
            <div
              key={person.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border-soft px-3 py-2 dark:border-border"
            >
              <span className="truncate text-sm text-plum-body dark:text-foreground">
                {person.full_name || "Unnamed user"}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(person)}
                disabled={busyId === person.id}
                className={cn(courseIconButton, "hover:text-[#9A3D3D]")}
                title="Remove from this course"
                aria-label={`Remove ${person.full_name || "assistant"} from this course`}
              >
                {busyId === person.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add an assistant */}
      <div className="mt-4 border-t border-border-soft pt-4 dark:border-border">
        {candidates.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {assistants.length > 0
              ? "Everyone with the Teaching Assistant role is already on this course."
              : "No one has the Teaching Assistant role yet. Grant it on the Users page, then assign them here."}
          </p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="min-w-0 flex-1 rounded-[10px] border border-border bg-card px-3 py-2 text-[13px] text-plum-body focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-foreground"
              aria-label="Choose a Teaching Assistant to add"
            >
              <option value="">Choose a Teaching Assistant…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name || "Unnamed user"}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAssign}
              disabled={assigning || !selected}
              className={cn(
                selected ? courseButtonPrimary : courseButton,
                "cursor-pointer justify-center disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              {assigning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Assign
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
