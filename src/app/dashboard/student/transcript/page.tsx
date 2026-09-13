/**
 * Student transcript page (Module 5) — the student's own academic record.
 *
 * This deliberately uses the RLS-scoped client (not the service role): a
 * student may only ever read their own enrollments, grades and transcripts, so
 * the same page proves the row-level security is sufficient. They can view and
 * print, but there is no issue/void control here.
 */
import { redirect } from "next/navigation";
import { ScrollText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { TranscriptDocument } from "@/components/transcript/transcript-document";
import { PrintTranscriptButton } from "@/components/transcript/print-button";
import {
  IssuedTranscriptList,
  type IssuedTranscriptRow,
} from "@/components/transcript/issued-transcript-list";
import { fetchTranscriptForStudent, type TranscriptData } from "@/lib/transcripts";

export default async function StudentTranscriptPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const data = await fetchTranscriptForStudent(
    supabase,
    user.id,
    profile?.full_name ?? "Student"
  );

  const { data: issuedRows } = await supabase
    .from("transcripts")
    .select(
      "id, serial, issued_at, notes, snapshot, issuer:profiles!transcripts_issued_by_fkey(full_name)"
    )
    .eq("student_id", user.id)
    .order("issued_at", { ascending: false });

  const issued: IssuedTranscriptRow[] = (issuedRows ?? []).map((r) => {
    const row = r as unknown as {
      id: string;
      serial: string;
      issued_at: string;
      notes: string | null;
      snapshot: TranscriptData;
      issuer: { full_name: string } | { full_name: string }[] | null;
    };
    const issuer = Array.isArray(row.issuer)
      ? row.issuer[0] ?? null
      : row.issuer;
    return {
      id: row.id,
      serial: row.serial,
      issuedAt: row.issued_at,
      issuedByName: issuer?.full_name ?? null,
      notes: row.notes ?? null,
      snapshot: row.snapshot,
    };
  });

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="My progress"
        title="My Transcript"
        subtitle="Your grades across every course, with any official transcripts your teachers have issued."
        icon={ScrollText}
        actions={
          <div className="print:hidden">
            <PrintTranscriptButton />
          </div>
        }
      />

      <TranscriptDocument data={data} />

      <section className="mt-8">
        <h2 className="mb-3 font-heading text-lg font-bold print:hidden">
          Official transcripts
        </h2>
        <div className="print:hidden">
          <IssuedTranscriptList studentId={user.id} items={issued} />
        </div>
      </section>
    </div>
  );
}
