/**
 * Registration is Google-only — the institute account is a Google sign-in.
 * "Sign up with Google" runs the same OAuth flow as login; a first-time
 * account is provisioned by the handle_new_user() trigger (role 'student',
 * name/avatar from Google), so there is no separate email/password path.
 */
import { GoogleSignInButton } from "@/components/auth/google-signin-button";

export function RegisterForm() {
  return (
    <div className="space-y-5">
      <GoogleSignInButton label="Sign up with Google" />
    </div>
  );
}
