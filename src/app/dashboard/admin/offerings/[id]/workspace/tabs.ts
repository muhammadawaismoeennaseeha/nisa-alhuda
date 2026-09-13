/**
 * The workspace's tab vocabulary, in a module neither side owns.
 *
 * `course-workspace` is a Client Component, so the server page can't import a
 * function from it — an export of a "use client" module reaches the server as a
 * client reference, not something callable. The page needs to validate `?tab=`
 * before it renders, hence this plain module: both sides import the keys, and
 * the tab strip's labels and icons stay with the component that draws them.
 */
export const TAB_KEYS = [
  "overview",
  "people",
  "structure",
  "schedule",
  "details",
] as const;

export type TabKey = (typeof TAB_KEYS)[number];

export function isTabKey(value: string | undefined): value is TabKey {
  return TAB_KEYS.includes(value as TabKey);
}
