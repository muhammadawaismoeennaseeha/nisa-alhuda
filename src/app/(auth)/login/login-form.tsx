import { GoogleSignInButton } from "@/components/auth/google-signin-button";

interface LoginFormProps {
  redirectTo?: string;
}

export function LoginForm({ redirectTo }: LoginFormProps) {
  return (
    <div className="space-y-5">
      <GoogleSignInButton next={redirectTo || "/dashboard"} />
    </div>
  );
}
