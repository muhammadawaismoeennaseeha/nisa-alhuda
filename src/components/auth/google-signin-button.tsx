"use client";

/**
 * "Continue with Google" button.
 *
 * Kicks off Supabase's OAuth flow. Supabase redirects the browser to Google,
 * Google sends the user back to /auth/callback with a `code`, and the existing
 * callback route exchanges that code for a session (see src/app/auth/callback).
 *
 * New Google users flow through the same handle_new_user() trigger as an
 * email/password signup: a profile is created (role defaults to `student`,
 * name + avatar taken from the Google account) and any guest enrolment with a
 * matching email is linked automatically. So no database change is needed here.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

interface GoogleSignInButtonProps {
  /** Where to land after a successful sign-in. Defaults to /dashboard. */
  next?: string;
  /** Verb shown on the button ("Continue" on login, "Sign up" on register). */
  label?: string;
}

export function GoogleSignInButton({
  next = "/dashboard",
  label = "Continue with Google",
}: GoogleSignInButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const supabase = createClient();

    // Send Google's response back to our callback route, carrying the intended
    // destination. window.location.origin resolves to localhost in dev and the
    // public host in production, both of which are on Supabase's redirect
    // allow-list.
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
      next,
    )}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        // Always show the account chooser so a shared device doesn't silently
        // reuse the previous person's Google session.
        queryParams: { prompt: "select_account" },
      },
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
    }
    // On success the browser navigates away to Google, so we intentionally
    // leave `loading` true — the button stays disabled through the redirect.
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={loading}
      className="h-11 w-full rounded-full text-sm font-semibold"
    >
      {loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <GoogleGlyph className="mr-2 h-4 w-4" />
      )}
      {label}
    </Button>
  );
}

/** Google's four-colour "G" mark, inlined so no external asset is fetched. */
function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
