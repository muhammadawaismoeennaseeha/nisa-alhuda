-- 036_transcripts.sql
-- Module 5: official issued transcripts.
--
-- The LIVE transcript is computed on the fly from the gradebook (migrations
-- 034 quizzes + 035 assessments) and always reflects current grades. ISSUING
-- a transcript writes a permanent, dated snapshot that never changes even if a
-- grade is edited afterwards — the registrar's official record of what the
-- student had earned at that moment.
--
-- Immutable by design: there is a SELECT/INSERT/DELETE story but deliberately
-- NO update policy. A mistaken transcript is voided (deleted by an admin), not
-- edited. The frozen figures live in `snapshot` (the full per-subject record)
-- plus the summary columns for cheap listing.

CREATE SEQUENCE IF NOT EXISTS transcript_serial_seq;

CREATE TABLE transcripts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    -- Human reference, e.g. NA-2026-0007. Global monotonic sequence; the year
    -- is cosmetic (invoice-style), so numbers never collide or reset.
    serial            TEXT NOT NULL UNIQUE DEFAULT (
                        'NA-' || to_char(now(), 'YYYY') || '-' ||
                        lpad(nextval('transcript_serial_seq')::text, 4, '0')
                      ),
    -- Frozen at issuance: a profile rename must not rewrite history.
    student_name      TEXT NOT NULL,
    cumulative_pct    NUMERIC(5,2),
    cumulative_letter TEXT,
    -- The full record as issued: offerings -> subjects -> items, with the
    -- per-subject and per-offering figures. See src/lib/transcripts.ts.
    snapshot          JSONB NOT NULL,
    notes             TEXT,
    issued_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
    issued_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX transcripts_student_idx ON transcripts (student_id);
CREATE INDEX transcripts_issued_at_idx ON transcripts (issued_at DESC);

ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;

-- Read: the student themselves, or any staff member.
CREATE POLICY transcripts_select ON transcripts FOR SELECT
  USING (
    student_id = auth.uid()
    OR has_role('admin') OR has_role('instructor')
  );

-- Issue: staff only.
CREATE POLICY transcripts_staff_insert ON transcripts FOR INSERT
  WITH CHECK (has_role('admin') OR has_role('instructor'));

-- Void: admin only. No UPDATE policy exists anywhere — issued transcripts are
-- immutable; a mistake is deleted, not rewritten.
CREATE POLICY transcripts_admin_delete ON transcripts FOR DELETE
  USING (has_role('admin'));
