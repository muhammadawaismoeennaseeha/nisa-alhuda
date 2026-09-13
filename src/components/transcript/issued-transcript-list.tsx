"use client";

/**
 * IssuedTranscriptList — the official, frozen transcripts already issued for a
 * student. Each row expands to its full printable document (rebuilt from the
 * stored snapshot, so it shows the figures AS ISSUED, not today's grades).
 *
 * Voiding is optional: the staff page passes the admin-only `voidAction`; the
 * student view passes nothing, so students can view and print but never void.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { gradeBadgeClasses } from "@/lib/utils/grades";
import type { TranscriptData } from "@/lib/transcripts";
import { TranscriptDocument } from "./transcript-document";
import { PrintTranscriptButton } from "./print-button";

export interface IssuedTranscriptRow {
  id: string;
  serial: string;
  issuedAt: string;
  issuedByName: string | null;
  notes: string | null;
  snapshot: TranscriptData;
}

export function IssuedTranscriptList({
  studentId,
  items,
  voidAction,
}: {
  studentId: string;
  items: IssuedTranscriptRow[];
  voidAction?: (
    transcriptId: string,
    studentId: string
  ) => Promise<{ success: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        No official transcripts issued yet.
      </p>
    );
  }

  function doVoid(row: IssuedTranscriptRow) {
    if (!voidAction) return;
    if (
      !window.confirm(
        `Void transcript ${row.serial}? This permanently deletes the issued record. Grades are not affected.`
      )
    )
      return;
    startTransition(async () => {
      const res = await voidAction(row.id, studentId);
      if (!res.success) {
        toast.error(res.error ?? "Could not void the transcript.");
        return;
      }
      toast.success(`Voided ${row.serial}`);
      setOpenId(null);
      router.refresh();
    });
  }

  return (
    <ul className="space-y-3">
      {items.map((row) => {
        const open = openId === row.id;
        const date = new Date(row.issuedAt).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
        const pct = row.snapshot.cumulativePct;
        return (
          <li
            key={row.id}
            className="overflow-hidden rounded-xl border border-border print:border-0"
          >
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 print:hidden">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : row.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                aria-expanded={open}
              >
                {open ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0">
                  <span className="font-mono text-sm font-semibold">
                    {row.serial}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    Issued {date}
                    {row.issuedByName ? ` · ${row.issuedByName}` : ""}
                  </span>
                </span>
              </button>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${gradeBadgeClasses(
                  pct
                )}`}
              >
                {pct === null ? "—" : `${pct}%`}
                {row.snapshot.cumulativeLetter && (
                  <>
                    <span className="opacity-70">·</span>
                    {row.snapshot.cumulativeLetter}
                  </>
                )}
              </span>
              {voidAction && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => doVoid(row)}
                  disabled={pending}
                  className="text-rose-600 hover:text-rose-700"
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Void
                </Button>
              )}
            </div>

            {open && (
              <div className="border-t border-border bg-muted/20 p-4 print:border-0 print:bg-transparent print:p-0">
                <div className="mb-3 flex justify-end print:hidden">
                  <PrintTranscriptButton />
                </div>
                <TranscriptDocument
                  data={row.snapshot}
                  issued={{
                    serial: row.serial,
                    issuedAt: row.issuedAt,
                    issuedByName: row.issuedByName,
                    notes: row.notes,
                  }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
