import { cn } from "cn";

/** `surface-work` as a component: white, 16px radius, one soft blue-tinted shadow, no border — the page's primary content. */
export function Card({ className, children, ...rest }: React.ComponentProps<"div">) {
  return (
    <div className={cn("surface-work", className)} {...rest}>
      {children}
    </div>
  );
}
