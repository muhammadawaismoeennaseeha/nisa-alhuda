"use client";

/**
 * Monthly payment form — the 2-card "Payment Details + Upload Receipt"
 * UI that mirrors the initial enrollment receipt screen. Used by the
 * monthly-payment page (linked from the dashboard's "Pay [month] fee"
 * banner).
 *
 * Region (PK / IN / Intl) is locked from the enrollment's currency —
 * unlike the enrollment wizard, sisters don't pick their bank here.
 * They already chose their currency when they enrolled.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { submitMonthlyPayment } from "../../offerings/[id]/monthly-payment-actions";
import {
  PAYMENT_METHODS,
  PAYMENT_REFERENCE_NOTE,
  type PaymentRegion,
} from "@/lib/payment-methods";

export type Region = PaymentRegion;

interface Props {
  enrollmentId: string;
  offeringTitle: string;
  cycleMonth: string;
  cycleLabel: string;
  amount: number;
  currency: "PKR" | "INR" | "USD";
  /** True when `amount` is the sister's FA-approved reduced rate. */
  isFaReduced: boolean;
  /** The offering's full (non-FA) price in the sister's currency, for
   *  "instead of PKR 3,000" copy. Null if the offering has no price set
   *  in that currency (rare). */
  fullPrice: number | null;
  /** Starting region — sister can toggle to view other regions' methods. */
  defaultRegion: Region;
  /** Whether the INTL toggle button should be shown (depends on offering). */
  hasIntlPrice: boolean;
  /** Whether the IN toggle button should be shown — currently always true. */
  hasInrPrice: boolean;
  defaultSenderName: string;
  previousRejectionReason: string | null;
}

function formatAmount(amount: number, currency: "PKR" | "INR" | "USD"): string {
  if (currency === "USD")
    return `$${amount.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })} USD`;
  if (currency === "INR") return `₹${amount.toLocaleString("en-IN")}`;
  return `PKR ${amount.toLocaleString("en-PK")}`;
}

export function MonthlyPaymentForm({
  enrollmentId,
  offeringTitle,
  cycleMonth,
  cycleLabel,
  amount,
  currency,
  isFaReduced,
  fullPrice,
  defaultRegion,
  hasIntlPrice,
  hasInrPrice,
  defaultSenderName,
  previousRejectionReason,
}: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [senderName, setSenderName] = useState(defaultSenderName || "");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  // Region is locally toggleable so the sister can browse other regions'
  // payment methods (mirrors the enrollment view). The submitted amount +
  // currency stay locked to the enrollment's stored values — the toggle
  // just swaps which bank details are visible.
  const [region, setRegion] = useState<Region>(defaultRegion);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const okType =
      f.type.startsWith("image/") || f.type === "application/pdf";
    if (!okType) {
      toast.error("Please upload an image or PDF.", { duration: 6000 });
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      // 10MB cap — matches server bodySizeLimit's raw-file capacity after
      // base64 overhead. Modern phone screenshots exceed 5MB routinely;
      // if this rejects, the sister is stuck and won't know why.
      // Duration bumped so sisters on phones don't miss the toast.
      const mb = (f.size / (1024 * 1024)).toFixed(1);
      toast.error(
        `File is ${mb}MB — must be under 10MB. Please compress or crop the screenshot and try again.`,
        { duration: 8000 }
      );
      return;
    }
    setFile(f);
  }

  async function onSubmit() {
    if (!senderName.trim()) {
      toast.error("Please enter the sender name on the payment.");
      return;
    }
    if (!file) {
      toast.error("Please select a receipt first.");
      return;
    }

    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const result = await submitMonthlyPayment({
        enrollmentId,
        cycleMonth,
        receiptBase64: base64,
        receiptFileName: file.name,
        senderName: senderName.trim(),
      });

      if (!result.success) {
        toast.error(result.error || "Failed to submit receipt.");
        return;
      }

      toast.success(
        `Receipt submitted for ${cycleLabel} — awaiting admin review.`
      );
      router.push("/dashboard/student");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      {previousRejectionReason && (
        <div className="mb-4 flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold text-destructive">
              Previous receipt for {cycleLabel} was rejected
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Reason: {previousRejectionReason}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Please upload a corrected receipt below.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* ── Payment Details ── */}
        <Card>
          <CardContent className="p-6">
            <h2 className="mb-4 font-heading text-lg font-semibold">
              Payment Details
            </h2>

            <div className="space-y-4">
              <div className="rounded-xl bg-secondary/60 p-4">
                <div className="mb-1 flex items-center gap-2">
                  <p className="text-sm text-muted-foreground">
                    Amount for {cycleLabel}
                  </p>
                  {isFaReduced && (
                    <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                      Fee Concession
                    </span>
                  )}
                </div>
                <p className="text-2xl font-bold text-primary">
                  {formatAmount(amount, currency)}
                </p>
                {isFaReduced && fullPrice && fullPrice > amount && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Full fee: {formatAmount(fullPrice, currency)} · your
                    approved concession amount
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {offeringTitle}
                </p>
              </div>

              {/* Region toggle — mirrors the enrollment view so sisters
                  can pick whichever payment method is easiest for them
                  this cycle. The amount + currency we record stay locked
                  to her enrollment, so the displayed PKR/INR/USD totals
                  do NOT change when she toggles — only the bank/UPI/
                  PayPal etc. account details below do. */}
              <div
                className={`grid gap-1 rounded-lg bg-secondary p-1 ${
                  hasIntlPrice ? "grid-cols-3" : "grid-cols-2"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setRegion("pk")}
                  className={`rounded-md py-2 text-sm font-medium transition-colors ${
                    region === "pk"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {PAYMENT_METHODS.pk.flag} {PAYMENT_METHODS.pk.label}
                </button>
                {hasInrPrice && (
                  <button
                    type="button"
                    onClick={() => setRegion("in")}
                    className={`rounded-md py-2 text-sm font-medium transition-colors ${
                      region === "in"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {PAYMENT_METHODS.in.flag} {PAYMENT_METHODS.in.label}
                  </button>
                )}
                {hasIntlPrice && (
                  <button
                    type="button"
                    onClick={() => setRegion("intl")}
                    className={`rounded-md py-2 text-sm font-medium transition-colors ${
                      region === "intl"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {PAYMENT_METHODS.intl.flag} {PAYMENT_METHODS.intl.label}
                  </button>
                )}
              </div>

              {/* Payment methods — sourced from src/lib/payment-methods.ts
                  so this view + the enrollment wizard stay in lock-step. */}
              {PAYMENT_METHODS[region].methods.map((method, idx) => (
                <div key={method.title}>
                  {PAYMENT_METHODS[region].methods.length > 1 && (
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {method.title}
                    </p>
                  )}
                  <div className="space-y-3">
                    {method.fields.map((field) => (
                      <Field
                        key={field.label}
                        label={field.label}
                        value={field.value}
                        mono={field.mono}
                      />
                    ))}
                  </div>
                  {idx < PAYMENT_METHODS[region].methods.length - 1 && (
                    <div className="my-3 border-t border-border/60" />
                  )}
                </div>
              ))}

              <div className="rounded-lg border border-primary/10 bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">
                  <strong>Important:</strong> {PAYMENT_REFERENCE_NOTE}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Upload Payment Receipt ── */}
        <Card>
          <CardContent className="p-6">
            <h2 className="mb-4 font-heading text-lg font-semibold">
              Upload Payment Receipt
            </h2>

            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="senderName">Sender Name (on payment)</Label>
                <Input
                  id="senderName"
                  placeholder="Name used in bank transfer"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  disabled={uploading}
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  Pre-filled from your account name. Update if the bank
                  transfer was sent from a different name (e.g. a
                  relative&apos;s account).
                </p>
              </div>

              <div className="space-y-2">
                <Label>Receipt Screenshot</Label>

                {!file ? (
                  <label
                    htmlFor="receipt"
                    className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border p-6 transition-colors hover:border-primary/50 hover:bg-secondary/30"
                  >
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <div className="text-center">
                      <p className="text-sm font-medium">Click to upload</p>
                      <p className="text-xs text-muted-foreground">
                        JPG, PNG, WebP or PDF — Max 10MB
                      </p>
                    </div>
                    <input
                      id="receipt"
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={onPickFile}
                      className="hidden"
                      disabled={uploading}
                    />
                  </label>
                ) : (
                  <div className="flex items-center gap-3 rounded-xl border-2 border-primary/40 bg-primary/5 p-4">
                    <CheckCircle className="h-6 w-6 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {file.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {(file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        if (fileInputRef.current)
                          fileInputRef.current.value = "";
                      }}
                      disabled={uploading}
                      className="text-xs text-muted-foreground underline hover:text-foreground"
                    >
                      Replace
                    </button>
                  </div>
                )}
              </div>

              <Button
                onClick={onSubmit}
                disabled={!file || !senderName.trim() || uploading}
                className="w-full"
                size="lg"
              >
                {uploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  `Submit Receipt for ${cycleLabel}`
                )}
              </Button>

              <p className="text-center text-[11px] text-muted-foreground">
                The admin team will review your receipt and approve your
                payment shortly. You&apos;ll get an email when it&apos;s done.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`font-medium ${mono ? "font-mono text-xs sm:text-sm" : ""}`}>
        {value}
      </p>
    </div>
  );
}
