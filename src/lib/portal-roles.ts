/**
 * Portal-role helpers — small predicates the admin UI uses to decide
 * who sees what. Centralises the "instructor sees admin screens but
 * not billing" rule from spec so JSX call sites stay readable.
 *
 * NOTE: these are purely UI-layer hints. RLS in migration 028 +
 * server-action role checks are the source of truth for what a user
 * can actually do. Never rely on these flags alone to gate a write.
 */
import type { UserRole } from "@/lib/types/database";

export type AdminPortalRole = "admin" | "instructor" | "treasurer";

/**
 * True when the viewer should be treated as "admin-equivalent" for
 * page access — admin or instructor. Treasurers are NOT included
 * here because they only get the payment ledger; they have their
 * own narrower scope handled in the admin layout.
 */
export function isAdminOrInstructor(role: UserRole | null | undefined): boolean {
  return role === "admin" || role === "instructor";
}

/**
 * True when financial UI must be hidden from this viewer. Currently
 * only instructors qualify — they share the admin screens but the
 * spec says "hide all financial fields" from them.
 *
 * Treasurers are NOT hidden because their entire scope IS finance.
 */
export function shouldHideFinance(
  role: UserRole | null | undefined
): boolean {
  // Instructors and TAs are teaching staff; the spec hides all financial
  // fields from both. Treasurers and admins are unaffected.
  return role === "instructor" || role === "ta";
}

/**
 * True when the viewer is teaching staff — a full instructor or a course-
 * scoped Teaching Assistant. Both live in the instructor area; the TA is
 * additionally narrowed to their assigned courses at the data layer.
 */
export function isTeachingStaff(
  role: UserRole | null | undefined
): boolean {
  return role === "instructor" || role === "ta";
}

/**
 * True when this viewer is allowed into a billing/payment-bearing
 * route (the Payment Ledger and Billing Grid). Used by route guards.
 */
export function canAccessBilling(
  role: UserRole | null | undefined
): boolean {
  return role === "admin" || role === "treasurer";
}

/**
 * Human label for a role, for the sidebar/mobile user card. Most roles read
 * fine when capitalised, but "ta" would render as "Ta"; spell it out instead.
 */
export function roleLabel(role: UserRole | null | undefined): string {
  switch (role) {
    case "ta":
      return "Teaching Assistant";
    case "admin":
      return "Admin";
    case "instructor":
      return "Instructor";
    case "treasurer":
      return "Treasurer";
    case "student":
      return "Student";
    default:
      return role ?? "";
  }
}
