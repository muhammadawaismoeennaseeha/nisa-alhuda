/**
 * Prove, against a real Postgres, that editing a lesson cannot lose its
 * recording.
 *
 *   npx tsx scripts/p3-verify-recording-preserved.ts
 *
 * `__tests__/lib/course-structure.test.ts` pins the same guarantee against a
 * fake client — fast, and what CI runs. This script closes the remaining gap:
 * that PostgREST and Postgres actually treat an absent key as "leave the column
 * alone" rather than as NULL. It imports the *production* `updateLesson` /
 * `diffLesson`, not a copy.
 *
 * ─── Safety ────────────────────────────────────────────────────────────────
 *
 * Every row this script creates is titled with the `P3TMP` prefix, and the only
 * thing it deletes is the single offering it created (whose FK cascade reaches
 * nothing but its own subject and lesson). It never reads, writes or deletes a
 * row it did not create. Pair it with `node scripts/recordings-snapshot.mjs
 * --verify` either side to confirm that from the outside.
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { diffLesson, updateLesson } from "../src/lib/course-structure";
import type { Lesson } from "../src/lib/types/database";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error(
    "✖ SUPABASE_SERVICE_ROLE_KEY missing — is .env.local active? (npm run env:local)"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PREFIX = "P3TMP";
// A URL with query string, unicode and mixed case — anything that mangles a
// string on the round trip shows up as a byte diff.
const RECORDING =
  "https://drive.google.com/file/d/1AbC_dEfG-hIjK/view?usp=sharing&t=42s#Ṭahāra";

let offeringId: string | null = null;
let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "✔" : "✖"} ${label}${detail ? `\n    ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  // subjects.instructor_id is NOT NULL — borrow any existing profile id. Read
  // only; the profile itself is never modified.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .limit(1)
    .single();

  if (profileError || !profile) {
    console.error(
      "✖ No profiles in this database — seed it first (npm run seed)."
    );
    process.exit(1);
  }

  const stamp = process.pid;

  const { data: offering, error: offeringError } = await supabase
    .from("offerings")
    .insert({
      title: `${PREFIX} throwaway course ${stamp}`,
      slug: `${PREFIX.toLowerCase()}-throwaway-${stamp}`,
      description: `${PREFIX} fixture. Safe to delete.`,
      type: "program",
      status: "draft",
      instructor_id: profile.id,
    })
    .select("id")
    .single();

  if (offeringError || !offering) throw new Error(offeringError?.message);
  offeringId = offering.id;
  console.log(`  created ${PREFIX} offering ${offeringId}`);

  const { data: subject, error: subjectError } = await supabase
    .from("subjects")
    .insert({
      offering_id: offeringId,
      title: `${PREFIX} throwaway subject`,
      slug: `${PREFIX.toLowerCase()}-throwaway-subject`,
      instructor_id: profile.id,
      sort_order: 0,
    })
    .select("id")
    .single();

  if (subjectError || !subject) throw new Error(subjectError?.message);

  const { data: created, error: lessonError } = await supabase
    .from("lessons")
    .insert({
      offering_id: offeringId,
      subject_id: subject.id,
      title: `${PREFIX} throwaway class`,
      description: "Original description.",
      recording_url: RECORDING,
      sort_order: 0,
      is_published: false,
    })
    .select("*")
    .single<Lesson>();

  if (lessonError || !created) throw new Error(lessonError?.message);
  // Bound to a const so the closure below keeps the non-null narrowing.
  const lessonId = created.id;

  check(
    "fixture stored the recording verbatim",
    created.recording_url === RECORDING,
    `stored: ${created.recording_url}`
  );

  /** Re-read the row and compare its recording byte-for-byte. */
  async function assertIntact(label: string): Promise<Lesson> {
    const { data, error } = await supabase
      .from("lessons")
      .select("*")
      .eq("id", lessonId)
      .single<Lesson>();

    if (error || !data) throw new Error(error?.message);
    check(
      label,
      data.recording_url === RECORDING,
      data.recording_url === RECORDING
        ? undefined
        : `expected: ${RECORDING}\n    actual:   ${data.recording_url}`
    );
    return data;
  }

  // 1 — the headline case: rename via the real admin path.
  await updateLesson(
    supabase,
    lessonId,
    diffLesson(created, { title: `${PREFIX} renamed class` })
  );
  const afterRename = await assertIntact(
    "recording_url intact after a title-only edit"
  );
  check(
    "the title actually changed",
    afterRename.title === `${PREFIX} renamed class`
  );

  // 2 — title + description, the shape the edit dialog most often emits.
  await updateLesson(
    supabase,
    lessonId,
    diffLesson(afterRename, {
      title: `${PREFIX} renamed again`,
      description: "Rewritten description.",
      scheduled_at: "2026-03-01T13:00:00.000Z",
      live_class_link: "https://meet.google.com/abc-defg-hij",
      is_published: true,
    })
  );
  const afterEdit = await assertIntact(
    "recording_url intact after a full field edit that omits it"
  );
  check(
    "the other columns did change",
    afterEdit.description === "Rewritten description." &&
      afterEdit.is_published === true &&
      afterEdit.live_class_link === "https://meet.google.com/abc-defg-hij"
  );

  // 3 — publish toggle and reorder, the two one-column writes on the list.
  await updateLesson(supabase, lessonId, { is_published: false });
  await updateLesson(supabase, lessonId, { sort_order: 5 });
  await assertIntact("recording_url intact after publish toggle and reorder");

  // 4 — a stale full row that never had the column. The allowlist drops what
  // it isn't given, so the statement still can't name recording_url.
  await updateLesson(supabase, lessonId, {
    title: `${PREFIX} from a stale copy`,
    description: null,
    scheduled_at: null,
    live_class_link: null,
    is_published: false,
    sort_order: 0,
  });
  await assertIntact("recording_url intact after a stale full-row write");
}

// tsx compiles this file to CJS, which has no top-level await.
async function run() {
  try {
    await main();
  } catch (error) {
    failures += 1;
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Tear down only what this script made. The FK cascade from this one
    // offering reaches its own subject and lesson and nothing else, and the
    // `like` guard means a wrong id can't delete a real course.
    if (offeringId) {
      const { error } = await supabase
        .from("offerings")
        .delete()
        .eq("id", offeringId)
        .like("title", `${PREFIX}%`);
      console.log(
        error
          ? `✖ CLEANUP FAILED for ${PREFIX} offering ${offeringId}: ${error.message}`
          : `  cleaned up ${PREFIX} offering ${offeringId}`
      );
      if (error) failures += 1;
    }
  }

  if (failures > 0) {
    console.error(`\n🚨  ${failures} check(s) FAILED — do not ship.`);
    process.exit(1);
  }
  console.log("\n✔ Recording preservation verified against the database.");
}

void run();
