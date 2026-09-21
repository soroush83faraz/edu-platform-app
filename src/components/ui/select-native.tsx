import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "cn"
import { controlClass } from "./input"

/* Styled native `<select>` — the one dropdown of phase 1 (no Radix Select: the OS picker is the right control on
   phones). Same material as `Input` (`controlClass`), `appearance-none`, and a lucide chevron placed with the logical
   `end-3` so it lands where every native select puts it in the page's direction — no `dir` read, no background
   data-URI (that would need a raw hex and cannot use a logical position). Layout classes (`flex-1`, widths) go on
   the wrapper via `wrapperClassName`; `className` reaches the `<select>`. */
function SelectNative({
  className,
  wrapperClassName,
  children,
  ...props
}: React.ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <div data-slot="select-native-wrapper" className={cn("relative w-full", wrapperClassName)}>
      <select
        data-slot="select-native"
        className={cn(controlClass, "appearance-none pe-10 [&>option]:text-text [&>optgroup]:text-text", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute end-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

export { SelectNative }
