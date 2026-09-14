"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, Mail, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { GoogleSignInButton } from "@/components/auth/google-signin-button";

interface LoginFormProps {
  redirectTo?: string;
}

export function LoginForm({ redirectTo }: LoginFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const supabase = createClient();

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    // Validate redirect path against the user's role to prevent cross-role access.
    let safeDest = redirectTo || "/dashboard";
    if (redirectTo) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .single();
      const role = profile?.role;

      if (
        role === "student" &&
        (redirectTo.startsWith("/dashboard/admin") ||
          redirectTo.startsWith("/dashboard/instructor"))
      ) {
        safeDest = "/dashboard";
      } else if (role === "instructor" && redirectTo.startsWith("/dashboard/admin")) {
        safeDest = "/dashboard";
      }
    }

    toast.success("Welcome back!");
    router.push(safeDest);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <GoogleSignInButton next={redirectTo || "/dashboard"} />
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">or</span>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="aisha@example.com"
            className="h-11 pl-10"
            required
            autoFocus
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <PasswordInput
            id="password"
            name="password"
            placeholder="Your password"
            className="h-11 pl-10"
            required
          />
        </div>
      </div>

      <Button
        type="submit"
        disabled={loading}
        className="h-11 w-full rounded-full text-sm font-semibold"
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Logging in…
          </>
        ) : (
          <>
            <LogIn className="mr-2 h-4 w-4" />
            Log In
          </>
        )}
      </Button>
    </form>
    </div>
  );
}
