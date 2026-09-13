/**
 * Retired route — the roster now lives on the workspace's People tab.
 *
 * Only the page shell is retired. `EnrollDialog` and `actions.ts` in this
 * folder are unchanged and are rendered by `course-workspace`, which also
 * carries the intake columns (phone, age, education) this screen used to show.
 * Old bookmarks land on that tab instead of a 404.
 */
import { redirect } from "next/navigation";

export default async function OfferingStudentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/admin/offerings/${id}/workspace?tab=people`);
}
