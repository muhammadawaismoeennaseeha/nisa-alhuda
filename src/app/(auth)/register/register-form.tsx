"use client";

/**
 * Registration form — creates a new student account via Supabase signUp.
 * Adds a live password-strength meter so sisters know at a glance when their
 * password is acceptable (≥ 6 chars enforced, good practice encouraged).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail, User, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { GoogleSignInButton } from "@/components/auth/google-signin-button";

export function RegisterForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  /** When the user dismisses or accepts a typo suggestion, we don't show it again. */
  const [suggestionAccepted, setSuggestionAccepted] = useState(false);
  const emailSuggestion = suggestionAccepted ? null : suggestEmailFix(email);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const fullName = formData.get("full_name") as string;
    const submittedEmail = (formData.get("email") as string).trim();
    const pwd = formData.get("password") as string;
    const confirmPassword = formData.get("confirm_password") as string;

    // Block obvious bounces — Supabase will throttle the project if too many
    // emails bounce, which would lock new students out at signup.
    if (!isPlausibleEmail(submittedEmail)) {
      toast.error("That email doesn't look right. Please check and try again.");
      setLoading(false);
      return;
    }

    // If we have a typo suggestion the user hasn't seen, force them to confirm.
    const liveSuggestion = suggestEmailFix(submittedEmail);
    if (liveSuggestion && !suggestionAccepted) {
      toast.error(`Did you mean ${liveSuggestion}? Tap the suggestion below to fix or confirm your email.`);
      setLoading(false);
      return;
    }

    if (pwd.length < 6) {
      toast.error("Password must be at least 6 characters");
      setLoading(false);
      return;
    }

    if (pwd !== confirmPassword) {
      toast.error("Passwords do not match");
      setLoading(false);
      return;
    }

    const supabase = createClient();

    const { error } = await supabase.auth.signUp({
      email: submittedEmail,
      password: pwd,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    toast.success("Account created! Please check your email to verify.");
    router.push("/login");
  }

  const strength = passwordStrength(password);

  return (
    <div className="space-y-5">
      <GoogleSignInButton label="Sign up with Google" />
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
        <Label htmlFor="full_name">Full name</Label>
        <div className="relative">
          <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="full_name"
            name="full_name"
            placeholder="Aisha Ahmed"
            className="h-11 pl-10"
            required
            autoFocus
          />
        </div>
      </div>

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
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSuggestionAccepted(false);
            }}
          />
        </div>
        {emailSuggestion && (
          <button
            type="button"
            onClick={() => {
              setEmail(emailSuggestion);
              setSuggestionAccepted(true);
            }}
            className="mt-1 text-left text-xs text-primary hover:underline"
          >
            Did you mean <span className="font-medium">{emailSuggestion}</span>? Tap to fix.
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <PasswordInput
            id="password"
            name="password"
            placeholder="At least 6 characters"
            className="h-11 pl-10"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {/* Strength meter — only renders once the user starts typing */}
        {password.length > 0 && (
          <div className="space-y-1 pt-1">
            <div className="flex h-1 gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-full transition-colors ${
                    i < strength.score
                      ? strength.color
                      : "bg-muted"
                  }`}
                />
              ))}
            </div>
            <p className={`text-[11px] ${strength.textColor}`}>
              {strength.label}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm_password">Confirm password</Label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <PasswordInput
            id="confirm_password"
            name="confirm_password"
            placeholder="Repeat your password"
            className="h-11 pl-10"
            required
            minLength={6}
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
            Creating account…
          </>
        ) : (
          <>
            <UserPlus className="mr-2 h-4 w-4" />
            Create Account
          </>
        )}
      </Button>
    </form>
    </div>
  );
}

/**
 * Suggests a fix for common email-domain typos to reduce bounces.
 * Returns the corrected address if the domain looks like a near-miss of a
 * popular provider, otherwise null. Catches `gmial.com`, `yaho.com`,
 * `hotmial.com`, etc. Pure lookup — no network calls.
 */
function suggestEmailFix(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 1 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!domain.includes(".")) return null;

  const knownDomains = [
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "icloud.com",
    "live.com",
    "ymail.com",
    "proton.me",
    "protonmail.com",
  ];
  if (knownDomains.includes(domain)) return null;

  for (const known of knownDomains) {
    if (levenshtein(domain, known) <= 2 && domain !== known) {
      return `${local}@${known}`;
    }
  }
  return null;
}

/** Distance between two strings — for "did you mean" matching. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev: number[] = Array(b.length + 1)
    .fill(0)
    .map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] =
        a[i - 1] === b[j - 1]
          ? prevDiag
          : 1 + Math.min(prev[j], prev[j - 1], prevDiag);
      prevDiag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Quick sanity check before we hand the address to Supabase auth.
 * Browsers' native `type="email"` already enforces the basic shape; this is
 * a second line of defence against pasted garbage.
 */
function isPlausibleEmail(value: string): boolean {
  const v = value.trim();
  if (v.length < 5 || v.length > 254) return false;
  // Single @ with non-empty local + domain, and a dot in the domain.
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(v);
}

/**
 * Lightweight password strength scoring — intentionally simple, not zxcvbn.
 * Score range 0–4 drives how many bars fill in the meter.
 */
function passwordStrength(p: string) {
  let score = 0;
  if (p.length >= 6) score++;
  if (p.length >= 10) score++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) score++;

  if (score <= 1)
    return {
      score,
      label: "Weak — add length or symbols.",
      color: "bg-destructive/70",
      textColor: "text-destructive/80",
    };
  if (score === 2)
    return {
      score,
      label: "Okay — consider a longer password.",
      color: "bg-amber-500",
      textColor: "text-amber-700 dark:text-amber-400",
    };
  if (score === 3)
    return {
      score,
      label: "Good — strong enough.",
      color: "bg-emerald-500",
      textColor: "text-emerald-700 dark:text-emerald-400",
    };
  return {
    score,
    label: "Excellent — very secure.",
    color: "bg-emerald-600",
    textColor: "text-emerald-700 dark:text-emerald-400",
  };
}
