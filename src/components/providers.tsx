"use client";

import { Direction } from "radix-ui";
import { Toaster } from "@/components/ui/sonner";

/** Client-side providers for the whole app: Radix direction (RTL) + toast host. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <Direction.Provider dir="rtl">
      {children}
      <Toaster position="bottom-center" dir="rtl" />
    </Direction.Provider>
  );
}
