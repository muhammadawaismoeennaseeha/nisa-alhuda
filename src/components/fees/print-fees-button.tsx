"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Prints the fee-statement sheet. Print CSS in globals.css hides the chrome. */
export function PrintFeesButton() {
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
