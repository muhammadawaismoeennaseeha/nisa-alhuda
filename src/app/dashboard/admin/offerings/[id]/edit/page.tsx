/**
 * Retired route — the offering form now lives on the workspace's Details tab.
 *
 * The page shell is gone, not the form: `OfferingForm` (in
 * `../../offering-form`) is rendered by `course-workspace`, with the same
 * props, the same validation and the same save path. Old bookmarks and any
 * stale link land on that tab instead of a 404.
 */
import { redirect } from "next/navigation";

export default async function EditOfferingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/admin/offerings/${id}/workspace?tab=details`);
}
