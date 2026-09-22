import { cn } from "cn";

/**
 * The content column of every signed-in page: 16 px gutters on phones, 32 px from `lg:`, capped at 1200 px
 * (`max-w-content`) and centred under the rail. `size="reading"` narrows a detail page or a form to 48 rem —
 * a single column of prose or fields never runs the full width. Pages compose this once, at the top.
 */
export function ContentWidth({ size = "full", className, children, ...rest }: React.ComponentProps<"div"> & { size?: "full" | "reading" }) {
  return (
    <div className={cn("mx-auto flex w-full flex-col gap-5 px-4 pb-8 lg:px-8", size === "reading" ? "max-w-3xl" : "max-w-content", className)} {...rest}>
      {children}
    </div>
  );
}
