"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Prints the transcript sheet. Print CSS in TranscriptDocument hides chrome. */
export function PrintTranscriptButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => window.print()}
      className="print:hidden"
    >
      <Printer className="mr-1.5 h-4 w-4" />
      Print / Save PDF
    </Button>
  );
}
