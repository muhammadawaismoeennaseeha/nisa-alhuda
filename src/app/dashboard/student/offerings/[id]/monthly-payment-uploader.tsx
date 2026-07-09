/**
 * Monthly Payment Uploader — client component that captures a receipt file
 * and submits it via the `submitMonthlyPayment` server action.
 *
 * Sits inside <MonthlyPaymentCard> when the current cycle is unpaid or
 * was rejected and the student needs to re-upload.
 */
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatMonthlyAmount } from "@/lib/monthly-payments";
import { submitMonthlyPayment } from "./monthly-payment-actions";

interface Props {
  enrollmentId: string;
  cycleMonth: string;
  amount: number;
  currency: string;
  rejectedReason: string | null;
}

export function MonthlyPaymentUploader({
  enrollmentId,
  cycleMonth,
  amount,
  currency,
  rejectedReason,
}: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

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
    if (!file) {
      toast.error("Please select a receipt first.");
      return;
    }

    setUploading(true);
    try {
      // Read file as base64
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
      });

      if (!result.success) {
        toast.error(result.error || "Failed to submit receipt.");
        return;
      }

      toast.success("Receipt submitted — awaiting review.");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      {rejectedReason && (
        <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">
              Last receipt was rejected
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Reason: {rejectedReason}
            </p>
          </div>
        </div>
      )}

      <p className="text-sm">
        Upload this month&apos;s receipt for{" "}
        <span className="font-semibold">
          {formatMonthlyAmount(amount, currency)}
        </span>{" "}
        to continue your subscription.
      </p>

      <div className="flex flex-col sm:flex-row gap-2">
        <label className="flex-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={onPickFile}
            className="hidden"
            disabled={uploading}
          />
          <span
            className={`flex items-center gap-2 rounded-lg border-2 border-dashed px-3 py-2.5 text-sm cursor-pointer transition-colors ${
              file
                ? "border-primary/50 bg-primary/5 text-foreground"
                : "border-border hover:border-primary/30 text-muted-foreground"
            }`}
          >
            {file ? (
              <>
                <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate flex-1">{file.name}</span>
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 shrink-0" />
                <span>Select receipt (image or PDF, max 5MB)</span>
              </>
            )}
          </span>
        </label>
        <Button
          onClick={onSubmit}
          disabled={!file || uploading}
          className="sm:w-auto"
        >
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Uploading...
            </>
          ) : (
            "Submit receipt"
          )}
        </Button>
      </div>
    </div>
  );
}
