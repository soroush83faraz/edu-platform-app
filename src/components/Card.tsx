import { cn } from "cn";

/** The one card surface of the product: white, 16px radius, one soft blue-tinted shadow, no border. */
export function Card({ className, children, ...rest }: React.ComponentProps<"div">) {
  return (
    <div className={cn("rounded-card bg-surface shadow-1", className)} {...rest}>
      {children}
    </div>
  );
}
