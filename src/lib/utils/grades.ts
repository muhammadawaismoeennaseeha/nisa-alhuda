/**
 * Grade helpers — a single source of truth for how a percentage becomes a
 * letter, and how a set of graded items becomes a subject total.
 *
 * The gradebook (Module 4) blends two kinds of graded item into one subject
 * score: quiz results (migration 034, read live from quiz_attempts) and
 * manual assessments (migration 035). Both reduce to a percentage, and the
 * subject total is the SIMPLE MEAN of every item the student has been graded
 * on. Items the student hasn't attempted or hasn't been marked on are shown
 * as "—" and left OUT of the mean, so an unmarked item never drags a total
 * down before the teacher has entered it.
 *
 * The letter scale is the common US +/- scale; it lives here so a later
 * change (or a per-institute override) touches one place.
 */

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A percentage earned on one gradable item, or null if not yet graded. */
export type ItemPercentage = number | null;

export interface LetterBand {
  /** Inclusive lower bound of the band, as a percentage. */
  min: number;
  letter: string;
}

/** Standard US +/- letter scale, highest band first. Adjust here to retune. */
export const LETTER_BANDS: readonly LetterBand[] = [
  { min: 97, letter: "A+" },
  { min: 93, letter: "A" },
  { min: 90, letter: "A-" },
  { min: 87, letter: "B+" },
  { min: 83, letter: "B" },
  { min: 80, letter: "B-" },
  { min: 77, letter: "C+" },
  { min: 73, letter: "C" },
  { min: 70, letter: "C-" },
  { min: 67, letter: "D+" },
  { min: 63, letter: "D" },
  { min: 60, letter: "D-" },
  { min: 0, letter: "F" },
];

/** The letter for a percentage. Clamps below 0 to F, above 100 stays A+. */
export function getLetterGrade(pct: number): string {
  for (const band of LETTER_BANDS) {
    if (pct >= band.min) return band.letter;
  }
  return "F";
}

/**
 * The subject total: the simple mean of every GRADED item's percentage.
 * Ungraded items (null) are excluded. Returns null when nothing is graded
 * yet, so the UI can show "—" instead of a misleading 0%.
 */
export function subjectAveragePct(items: ItemPercentage[]): number | null {
  const graded = items.filter((v): v is number => v !== null);
  if (graded.length === 0) return null;
  return round2(graded.reduce((sum, v) => sum + v, 0) / graded.length);
}

/** marks/max as a percentage, rounded to 2dp. Guards a zero/absent max. */
export function marksToPct(marks: number, maxMarks: number): number {
  if (!maxMarks || maxMarks <= 0) return 0;
  return round2((marks / maxMarks) * 100);
}

/**
 * Tailwind classes for a coloured grade pill on the cream/rose surface:
 * green ≥90, sage ≥80, amber ≥70, soft-red below. Includes dark variants.
 */
export function gradeBadgeClasses(pct: number | null): string {
  if (pct === null)
    return "border-stone-200 bg-stone-50 text-stone-400 dark:border-stone-700 dark:bg-stone-800/40 dark:text-stone-500";
  if (pct >= 90)
    return "border-sage-200 bg-sage-50 text-sage-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300";
  if (pct >= 80)
    return "border-sage-200 bg-sage-50 text-sage-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300";
  if (pct >= 70)
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300";
  return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300";
}
