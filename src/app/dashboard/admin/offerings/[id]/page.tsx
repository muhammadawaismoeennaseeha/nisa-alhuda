/**
 * /dashboard/admin/offerings/[id] — the course workspace is the offering, so
 * the bare route resolves to it rather than 404ing.
 */
import { redirect } from "next/navigation";

export default async function OfferingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/admin/offerings/${id}/workspace`);
}
