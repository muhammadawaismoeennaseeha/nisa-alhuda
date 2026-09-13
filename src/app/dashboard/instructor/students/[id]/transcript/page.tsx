/**
 * Staff transcript page (Module 5) — view a student's live academic record and
 * issue an official, frozen transcript. Reachable by any staff member (the
 * gradebook RLS already lets admins and instructors read every student's
 * marks). Voiding an issued record is admin-only.
 */
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, ScrollText } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDashboardViewer } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/dashboard/page-header";
import { TranscriptDocument } from "@/components/transcript/transcript-document";
import { PrintTranscriptButton } from "@/components/transcript/print-button";
import {
  IssuedTranscriptList,
  type IssuedTranscriptRow,
} from "@/components/transcript/issued-transcript-list";
import { fetchTranscriptForStudent, type TranscriptData } from "@/lib/transcripts";
import { IssueTranscriptButton } from "./issue-transcript-button";
import { voidTranscript } from "./transcript-actions";

export default async function StaffTranscriptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: studentId } = await params;
  const viewer = await getDashboardViewer();
  if (!viewer) return null;
  // A transcript spans every course a student has taken, so it is not
  // course-scoped. A Teaching Assistant is scoped to their assigned courses
  // and does not issue or read full transcripts (a registrar function), and
  // this page reads through the RLS-bypassing service-role client — so the
  // TA is turned away here, same as a student.
  if (viewer.role === "student" || viewer.role === "ta") {
    redirect("/dashboard/instructor");
  }

  const admin = createAdminClient();

  const { data: student } = await admin
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", studentId)
    .single();
  if (!student) notFound();

  const data = await fetchTranscriptForStudent(admin, studentId, student.full_name);

  const { data: issuedRows } = await admin
    .from("transcripts")
    .select(
      "id, serial, issued_at, notes, snapshot, issuer:profiles!transcripts_issued_by_fkey(full_name)"
    )
    .eq("student_id", studentId)
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
      <Link
        href="/dashboard/instructor/students"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to students
      </Link>

      <PageHeader
        eyebrow="Student records"
        title={student.full_name}
        subtitle="Academic transcript — live record and official issued copies."
        icon={ScrollText}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <PrintTranscriptButton />
            <IssueTranscriptButton
              studentId={studentId}
              disabled={data.gradedSubjectCount === 0}
            />
          </div>
        }
      />

      <TranscriptDocument data={data} />

      <section className="mt-8">
        <h2 className="mb-3 font-heading text-lg font-bold print:hidden">
          Official transcripts
        </h2>
        <div className="print:hidden">
          <IssuedTranscriptList
            studentId={studentId}
            items={issued}
            voidAction={viewer.isAdmin ? voidTranscript : undefined}
          />
        </div>
      </section>
    </div>
  );
}
