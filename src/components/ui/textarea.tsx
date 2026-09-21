import * as React from "react"
import { cn } from "cn"
import { controlClass } from "./input"

/* Multi-line text control: the `Input` material (`controlClass`) with a 112 px floor and a slightly taller line
   (`leading-7`) for Persian body text; `field-sizing-content` lets it grow with what is typed, `rows` stays the
   floor for browsers without it. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(controlClass, "min-h-28 py-2.5 leading-7 field-sizing-content resize-y", className)}
      {...props}
    />
  )
}

export { Textarea }
