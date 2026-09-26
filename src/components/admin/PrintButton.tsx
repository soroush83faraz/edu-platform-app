"use client";

import { Printer } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

export function PrintButton({ className }: { className?: string }) {
  return (
    <Button type="button" variant="outline" className={cn("gap-2", className)} onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden />
      چاپ
    </Button>
  );
}
