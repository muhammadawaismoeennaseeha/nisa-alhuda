/**
 * The surface, button and chip vocabulary of the signed-off courses mockup,
 * kept in one place.
 *
 * The course workspace is the only screen in Nisa that renders a white card on
 * the cream page with a hairline rose edge and a soft rose shadow — shadcn's
 * `Card` uses a `ring-1 ring-foreground/10` grey instead. Rather than override
 * that ring at six call sites, the workspace components build on these strings,
 * so "what a course card looks like" has exactly one definition.
 *
 * Everything here resolves to tokens declared in `globals.css` (`--color-*`,
 * `--shadow-soft-rose*`, `--radius`), so dark mode and any future brand tweak
 * flow through without touching a component.
 */

/** A white card on cream: hairline rose border, soft rose shadow, --radius corners. */
export const courseCard =
  "rounded-[var(--radius)] border border-border-soft bg-card shadow-soft-rose dark:border-border dark:shadow-none";

/** Adds the nav-card lift: rose-200 edge, deeper shadow, a small rise. */
export const courseCardHover =
  "transition-all duration-150 hover:-translate-y-0.5 hover:border-rose-200 hover:shadow-soft-rose-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:hover:border-rose-800";

/** The mockup's `.btn`: white, hairline border, rose-50 wash on hover. */
export const courseButton =
  "inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-border bg-card px-3.5 py-2 text-[13px] font-semibold text-plum-body transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-foreground dark:hover:bg-rose-950/40";

/**
 * `.btn.danger` — a modifier, not a variant. Delete stays visually neutral
 * alongside Edit and Archive and only turns red under the cursor, so the
 * destructive action is never the loudest thing in the header.
 */
export const courseButtonDanger =
  "hover:border-[#E4A9A9] hover:bg-[#FBEEEE] hover:text-[#9A3D3D] dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-300";

/**
 * The square icon-only variant of `courseButton`, for the per-row control
 * clusters in the structure editor.
 *
 * A lesson row can carry five controls (up, down, publish, edit, delete); at
 * `courseButton`'s padding they would outweigh the lesson title they act on, so
 * this trades the label for a fixed 28px square and leans on `title`/`aria-label`.
 */
export const courseIconButton =
  "inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-rose-50 hover:text-plum-body disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-rose-950/40 dark:hover:text-foreground";

/** `.btn.primary` — solid rose, for the one affirmative action on a panel. */
export const courseButtonPrimary =
  "inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-rose-500 bg-rose-500 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:border-rose-700 hover:bg-rose-700";

/** The tinted icon square on metric and nav cards. */
export const iconTints = {
  brand: "bg-rose-50 text-rose-500 dark:bg-rose-950/50 dark:text-rose-300",
  success:
    "bg-sage-50 text-sage-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  warning: "bg-sand-50 text-sand-700 dark:bg-amber-950/50 dark:text-amber-300",
} as const;

export type IconTint = keyof typeof iconTints;

/**
 * Pill fills. `steel` is the instructor blue-grey — deliberately the only
 * non-rose hue in the roster, so "not a student" is legible at a glance
 * without a second read of the label.
 */
export const pillTones = {
  brand: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-200",
  success:
    "bg-sage-50 text-sage-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  warning: "bg-sand-50 text-sand-700 dark:bg-amber-950/50 dark:text-amber-300",
  steel: "bg-steel-50 text-steel-700 dark:bg-sky-950/50 dark:text-sky-300",
  muted: "bg-[#F3EEF0] text-muted-foreground dark:bg-muted",
} as const;

export type PillTone = keyof typeof pillTones;

/** Role and status pills. */
export const pillBase =
  "inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap";

/** The uppercase header badge — smaller and letter-spaced, unlike `pillBase`. */
export const badgeBase =
  "inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-[0.05em] uppercase whitespace-nowrap";

/** The neutral meta chip beside a lesson ("2 resources", "Live link"). */
export const courseTag =
  "inline-block shrink-0 rounded-full bg-[#F7F0EC] px-2.5 py-0.5 text-[11px] whitespace-nowrap text-muted-foreground dark:bg-muted";
