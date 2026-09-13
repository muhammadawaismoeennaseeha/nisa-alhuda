"use client";

/**
 * IssueTranscriptButton — staff action to freeze the student's current live
 * record into an official, serial-numbered transcript. Opens an inline note
 * field, then calls the issueTranscript server action.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { issueTranscript } from "./transcript-actions";

export function IssueTranscriptButton({
  studentId,
  disabled,
}: {
  studentId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await issueTranscript(studentId, notes);
      if (!res.success) {
        toast.error(res.error ?? "Could not issue the transcript.");
        return;
      }
      toast.success(`Issued official transcript ${res.data?.serial}`);
      setOpen(false);
      setNotes("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="print:hidden"
        title={
          disabled ? "Nothing has been graded yet" : "Freeze the current record"
        }
      >
        <FileCheck2 className="mr-1.5 h-4 w-4" />
        Issue official transcript
      </Button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-border bg-muted/30 p-3 print:hidden sm:max-w-sm">
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        Note (optional) — appears on the issued transcript
      </label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="e.g. Issued at the parent's request"
        className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button type="button" size="sm" onClick={submit} disabled={pending}>
          {pending ? "Issuing…" : "Confirm & issue"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
