/**
 * The payments / fees UI has been removed from the LMS. This route is kept
 * as a redirect so existing links and bookmarks resolve instead of 404-ing.
 * Backend payment data and server actions are untouched.
 */
import { redirect } from "next/navigation";

export default function Page() {
  redirect("/dashboard/admin");
}
