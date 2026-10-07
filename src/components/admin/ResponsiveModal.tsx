"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** `true` from `md` (768px) upward; false during SSR and on phones. */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

export interface ResponsiveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Phone: a sheet as tall as its content (a short pick list) instead of the full-height form sheet. */
  fit?: boolean;
  children: React.ReactNode;
}

/**
 * Desktop: centered Dialog. Phone: full-height bottom Sheet (the keyboard pushes the form up, not the page) — or,
 * with `fit`, a sheet as tall as its content with rounded top corners (a pick list, no keyboard).
 */
export function ResponsiveModal({ open, onOpenChange, title, description, fit = false, children }: ResponsiveModalProps) {
  const desktop = useIsDesktop();
  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg">{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={
          fit
            ? "max-h-[85dvh] overflow-y-auto rounded-t-hero pb-[env(safe-area-inset-bottom)]"
            : "h-[100dvh] overflow-y-auto rounded-t-none pb-[env(safe-area-inset-bottom)]"
        }
      >
        <SheetHeader className="pb-0">
          <SheetTitle className="text-lg">{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : <SheetDescription className="sr-only">{title}</SheetDescription>}
        </SheetHeader>
        <div className="px-4 pb-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
