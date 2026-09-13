/**
 * The one place Nisa writes a subject or a lesson.
 *
 * Two screens now edit course structure — the instructor's subject page and the
 * admin course workspace — and a second copy of "how do I save a lesson" is
 * exactly how a column quietly goes missing on one of them. Both import from
 * here.
 *
 * ─── Why the patch builders exist ──────────────────────────────────────────
 *
 * `lessons.recording_url` is the only record of a class recording anywhere in
 * the product. A full-row `update()` that happens to omit it — or that spreads
 * a form's state where the recording field was never rendered — blanks it for
 * good, with no undo and no backup.
 *
 * So updates here are **column patches, never rows**:
 *
 *   - `buildLessonUpdatePatch` copies an allowlist of columns and skips any key
 *     whose value is `undefined`. A key that isn't passed is not in the emitted
 *     patch, so PostgREST never names that column and the stored value stands.
 *   - `recording_url` is therefore untouched unless a caller passes it
 *     explicitly. Editing a title sends `{ title }` and nothing else.
 *   - `diffLesson` goes one step further for form callers: it compares against
 *     the loaded row and emits only what actually changed, so even a form that
 *     *does* render the recording field contributes nothing when it's untouched.
 *
 * `__tests__/lib/course-structure.test.ts` pins all of this.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lesson, Subject } from "@/lib/types/database";

/* ── Lessons ──────────────────────────────────────────────────────────── */

/**
 * Every `lessons` column a UI is allowed to write. Anything outside this list
 * (`id`, `created_at`, `updated_at`, …) is dropped rather than forwarded, so a
 * caller can hand a whole row to the builder without corrupting the record.
 */
export const LESSON_WRITABLE_COLUMNS = [
  "subject_id",
  "title",
  "description",
  "scheduled_at",
  "live_class_link",
  "recording_url",
  "sort_order",
  "is_published",
] as const;

export type LessonWritableColumn = (typeof LESSON_WRITABLE_COLUMNS)[number];

/** A partial lesson write. An absent key means "leave that column alone". */
export type LessonPatch = Partial<Pick<Lesson, LessonWritableColumn>>;

const LESSON_ALLOWED: ReadonlySet<string> = new Set(LESSON_WRITABLE_COLUMNS);

/**
 * Narrow an arbitrary object to the columns that may be written, dropping
 * `undefined` values.
 *
 * The `undefined` rule is the recording guarantee: `{ title: "x" }` and
 * `{ title: "x", recording_url: undefined }` both emit `{ title: "x" }`, so
 * neither statement mentions `recording_url` and neither can clear it.
 */
export function buildLessonUpdatePatch(input: LessonPatch): LessonPatch {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!LESSON_ALLOWED.has(key)) continue;
    if (value === undefined) continue;
    patch[key] = value;
  }
  return patch as LessonPatch;
}

/**
 * The changed columns between a loaded lesson and a form's proposed values.
 *
 * Form state is always fully populated, so submitting one would otherwise
 * re-send every column. Diffing keeps the statement to what the admin actually
 * touched — including, crucially, leaving `recording_url` out of the patch
 * whenever the field came back unchanged.
 */
export function diffLesson(current: Lesson, next: LessonPatch): LessonPatch {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(buildLessonUpdatePatch(next))) {
    if (current[key as LessonWritableColumn] === value) continue;
    patch[key] = value;
  }
  return patch as LessonPatch;
}

/** True when a lesson has a recording worth warning about before a delete. */
export function hasRecording(
  lesson: Pick<Lesson, "recording_url">
): lesson is Pick<Lesson, "recording_url"> & { recording_url: string } {
  return !!lesson.recording_url && lesson.recording_url.trim() !== "";
}

/**
 * Apply a patch to one lesson. No-ops on an empty patch rather than issuing an
 * `update()` with no columns, which PostgREST rejects.
 */
export async function updateLesson(
  supabase: SupabaseClient,
  lessonId: string,
  input: LessonPatch
): Promise<void> {
  const patch = buildLessonUpdatePatch(input);
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase
    .from("lessons")
    .update(patch)
    .eq("id", lessonId);

  if (error) throw new Error(error.message);
}

export interface NewLesson {
  offering_id: string;
  subject_id: string | null;
  title: string;
  sort_order: number;
  description?: string | null;
  scheduled_at?: string | null;
  live_class_link?: string | null;
  /** Optional on create — a class rarely has its recording before it happens. */
  recording_url?: string | null;
  is_published?: boolean;
}

/** The insert payload, with the nullable columns defaulted explicitly. */
export function buildLessonInsert(input: NewLesson) {
  return {
    offering_id: input.offering_id,
    subject_id: input.subject_id,
    title: input.title,
    description: input.description ?? null,
    scheduled_at: input.scheduled_at ?? null,
    live_class_link: input.live_class_link ?? null,
    recording_url: input.recording_url ?? null,
    sort_order: input.sort_order,
    is_published: input.is_published ?? false,
  };
}

export async function createLesson(
  supabase: SupabaseClient,
  input: NewLesson
): Promise<Lesson> {
  const { data, error } = await supabase
    .from("lessons")
    .insert(buildLessonInsert(input))
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Lesson;
}

/**
 * Delete one lesson and its resources.
 *
 * `resources.lesson_id` is `ON DELETE CASCADE`, so the explicit resources
 * delete is belt-and-braces against an environment where the constraint was
 * ever dropped — same order the instructor screen has always used.
 *
 * Callers are responsible for confirming first. `hasRecording()` exists so a
 * caller can name the recording that is about to be lost.
 */
export async function deleteLesson(
  supabase: SupabaseClient,
  lessonId: string
): Promise<void> {
  await supabase.from("resources").delete().eq("lesson_id", lessonId);

  const { error } = await supabase.from("lessons").delete().eq("id", lessonId);
  if (error) throw new Error(error.message);
}

/* ── Subjects ─────────────────────────────────────────────────────────── */

export const SUBJECT_WRITABLE_COLUMNS = [
  "title",
  "slug",
  "description",
  "instructor_id",
  "sort_order",
  "recurring_meeting_url",
  "recurring_schedule_label",
  "recurring_day_of_week",
  "recurring_start_time",
  "recurring_duration_minutes",
  "quiz_url",
] as const;

export type SubjectWritableColumn = (typeof SUBJECT_WRITABLE_COLUMNS)[number];

export type SubjectPatch = Partial<Pick<Subject, SubjectWritableColumn>>;

const SUBJECT_ALLOWED: ReadonlySet<string> = new Set(SUBJECT_WRITABLE_COLUMNS);

/** Same allowlist-and-skip-undefined contract as `buildLessonUpdatePatch`. */
export function buildSubjectUpdatePatch(input: SubjectPatch): SubjectPatch {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SUBJECT_ALLOWED.has(key)) continue;
    if (value === undefined) continue;
    patch[key] = value;
  }
  return patch as SubjectPatch;
}

/** Matches the slug the offering form generates, so the two stay comparable. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();
}

/**
 * A slug that won't trip `UNIQUE(offering_id, slug)`.
 *
 * `taken` is every other subject's slug on the same offering; `keep` is the row
 * being renamed, whose own slug must not count as a collision. Two subjects
 * called "Tafseer" become `tafseer` and `tafseer-2`.
 */
export function uniqueSubjectSlug(
  title: string,
  taken: Iterable<string>,
  keep?: string | null
): string {
  const base = slugify(title) || "subject";
  const used = new Set(taken);
  if (keep) used.delete(keep);
  if (!used.has(base)) return base;

  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export interface NewSubject {
  offering_id: string;
  title: string;
  slug: string;
  instructor_id: string;
  sort_order: number;
  description?: string | null;
  recurring_meeting_url?: string | null;
  recurring_schedule_label?: string | null;
  recurring_day_of_week?: number | null;
  recurring_start_time?: string | null;
  recurring_duration_minutes?: number | null;
}

export function buildSubjectInsert(input: NewSubject) {
  return {
    offering_id: input.offering_id,
    title: input.title,
    slug: input.slug,
    description: input.description ?? null,
    instructor_id: input.instructor_id,
    sort_order: input.sort_order,
    recurring_meeting_url: input.recurring_meeting_url ?? null,
    recurring_schedule_label: input.recurring_schedule_label ?? null,
    recurring_day_of_week: input.recurring_day_of_week ?? null,
    recurring_start_time: input.recurring_start_time ?? null,
    recurring_duration_minutes: input.recurring_duration_minutes ?? null,
  };
}

export async function createSubject(
  supabase: SupabaseClient,
  input: NewSubject
): Promise<Subject> {
  const { data, error } = await supabase
    .from("subjects")
    .insert(buildSubjectInsert(input))
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Subject;
}

export async function updateSubject(
  supabase: SupabaseClient,
  subjectId: string,
  input: SubjectPatch
): Promise<void> {
  const patch = buildSubjectUpdatePatch(input);
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase
    .from("subjects")
    .update(patch)
    .eq("id", subjectId);

  if (error) throw new Error(error.message);
}

/**
 * Delete one subject.
 *
 * `lessons.subject_id` is `ON DELETE CASCADE`, so deleting a subject that still
 * holds lessons destroys them — and any recording on them. The admin editor
 * only offers this on an empty subject, or behind a confirmation that names
 * every recording at risk; `deleteSubject` itself does not guess.
 */
export async function deleteSubject(
  supabase: SupabaseClient,
  subjectId: string
): Promise<void> {
  const { error } = await supabase
    .from("subjects")
    .delete()
    .eq("id", subjectId);

  if (error) throw new Error(error.message);
}

/* ── Reordering ───────────────────────────────────────────────────────── */

/**
 * Move the item at `index` one slot in `direction`, returning the new order.
 * Pure, so the editor can render optimistically and the test can check the
 * permutation without a database.
 */
export function moveInOrder<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= items.length) return items;
  if (target < 0 || target >= items.length) return items;

  const next = items.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Persist a new order as `sort_order = 0..n-1`.
 *
 * One statement per row: PostgREST `upsert` would need every NOT NULL column of
 * every row, which for lessons means re-sending `recording_url` — the exact
 * shape this module exists to avoid. `sort_order` alone is worth the round
 * trips.
 */
export async function persistOrder(
  supabase: SupabaseClient,
  table: "subjects" | "lessons",
  orderedIds: string[]
): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    const { error } = await supabase
      .from(table)
      .update({ sort_order: index })
      .eq("id", id);

    if (error) throw new Error(error.message);
  }
}
