/**
 * FeeStatePill — the one place that maps a PayState to a colour + label, shared
 * by the fee statement (Level 4) and the course roster (Level 3) so a state is
 * coloured identically wherever it appears. Pass `label` to override the default
 * wording (the roster says "Up to date" where the statement says "Paid").
 */
import type { PayState } from "@/lib/fees";

export const FEE_STATE_PILL: Record<PayState, string> = {
  paid: "border-sage-200 bg-sage-50 text-sage-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300",
  pending:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
  owed: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
  rejected: "border-border bg-muted text-muted-foreground line-through decoration-1",
  waived: "border-border bg-muted text-muted-foreground",
  no_fee: "border-border bg-muted text-muted-foreground",
};

export const FEE_STATE_LABEL: Record<PayState, string> = {
  paid: "Paid",
  pending: "In review",
  owed: "Owed",
  rejected: "Rejected",
  waived: "Waived",
  no_fee: "Free",
};

export function FeeStatePill({
  state,
  label,
}: {
  state: PayState;
  label?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${FEE_STATE_PILL[state]}`}
    >
      {label ?? FEE_STATE_LABEL[state]}
    </span>
  );
}
