"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button type="button" className="h-11 gap-2" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden />
      چاپ
    </Button>
  );
}
