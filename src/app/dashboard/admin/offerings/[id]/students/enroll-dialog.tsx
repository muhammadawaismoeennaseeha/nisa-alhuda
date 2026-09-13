"use client";

/**
 * "Manually enroll student" dialog — sits on the workspace's People tab.
 *
 * Handles both cases in one form:
 *   - Existing user (matched by email) → links enrollment to their profile.
 *   - New person → creates a guest enrollment with the name stashed so the
 *     roster isn't blank, and optionally fires a welcome/credentials email.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Loader2, Mail, Lock, Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { enrollByEmail } from "./actions";

interface EnrollDialogProps {
  offeringId: string;
  offeringTitle: string;
  /** Lets the roster toolbar style the trigger like its other buttons. */
  triggerClassName?: string;
  triggerLabel?: React.ReactNode;
}

const DEFAULT_TRIGGER_CLASS =
  "inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors press";

export function EnrollDialog({
  offeringId,
  offeringTitle,
  triggerClassName = DEFAULT_TRIGGER_CLASS,
  triggerLabel,
}: EnrollDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  /** "invite" = email a setup link; "password" = set password now, no email. */
  const [mode, setMode] = useState<"invite" | "password">("invite");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  function generatePassword(): string {
    const alphabet =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let out = "";
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    for (const b of bytes) out += alphabet[b % alphabet.length];
    return out;
  }

  function reset() {
    setEmail("");
    setFullName("");
    setMode("invite");
    setPassword("");
    setShowPassword(false);
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password);
      toast.success("Password copied.");
    } catch {
      toast.error("Copy failed — select and copy manually.");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Email is required.");
      return;
    }
    if (mode === "password" && password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }

    setSaving(true);
    try {
      const res = await enrollByEmail(
        offeringId,
        email,
        fullName,
        mode === "invite",
        mode === "password" ? password : undefined
      );
      if (!res.success) {
        toast.error(res.error || "Failed to enroll.");
        return;
      }

      const parts = [
        `Enrolled ${email}`,
        res.isGuest ? "(new account)" : "(existing user)",
      ];
      if (res.emailSent) parts.push("— welcome email sent.");
      if (mode === "password") parts.push("— password set.");
      toast.success(parts.join(" "));
      setOpen(false);
      reset();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger className={triggerClassName}>
        {triggerLabel ?? (
          <>
            <UserPlus className="h-4 w-4 mr-1.5" />
            Manually enroll student
          </>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enroll a student in {offeringTitle}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <p className="text-sm text-muted-foreground">
            Enter the student&apos;s email. If they already have an account
            we&apos;ll link to it; otherwise a new account is created.
          </p>

          <div className="space-y-2">
            <Label htmlFor="enroll-email">Email</Label>
            <Input
              id="enroll-email"
              type="email"
              placeholder="student@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="enroll-name">
              Full name <span className="text-muted-foreground">(optional for existing users)</span>
            </Label>
            <Input
              id="enroll-name"
              type="text"
              placeholder="e.g. Sana Ahmed"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>How should the student get access?</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("invite")}
                className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                  mode === "invite"
                    ? "border-primary bg-primary/5"
                    : "border-input hover:bg-muted/30"
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Mail className="h-3.5 w-3.5" />
                  Email setup link
                </span>
                <span className="text-xs text-muted-foreground">
                  Student clicks a link to set their own password.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMode("password")}
                className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                  mode === "password"
                    ? "border-primary bg-primary/5"
                    : "border-input hover:bg-muted/30"
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Lock className="h-3.5 w-3.5" />
                  Set password now
                </span>
                <span className="text-xs text-muted-foreground">
                  You share the password with the student yourself.
                </span>
              </button>
            </div>
          </div>

          {mode === "password" && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
              <Label htmlFor="enroll-password" className="text-sm">
                Password <span className="text-muted-foreground">(min 8 chars)</span>
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="enroll-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Generated or your choice"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-9 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPassword(generatePassword());
                    setShowPassword(true);
                  }}
                >
                  Generate
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyPassword}
                  disabled={!password}
                  title="Copy password"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                No email will be sent. Share this password with the student
                through your preferred channel — they&apos;ll be prompted to
                change it on first login.
              </p>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <UserPlus className="h-4 w-4 mr-2" />
              )}
              Enroll student
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
