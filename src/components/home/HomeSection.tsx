import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";

/** A Home section: title on the start side, one optional «همه →» link on the end side, then the content. */
export function HomeSection({
  id,
  title,
  more,
  children,
  className,
}: {
  id: string;
  title: string;
  more?: { href: string; label: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h3 id={`${id}-heading`} className="text-base font-semibold text-text">
          {title}
        </h3>
        {more ? (
          <Link href={more.href} className="inline-flex min-h-11 items-center gap-0.5 rounded-lg px-1 text-sm font-medium text-sky-strong hover:text-primary-700">
            {more.label}
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** The one card surface of the product: white, 16px radius, one soft blue-tinted shadow. */
export function Card({ className, children, ...rest }: React.ComponentProps<"div">) {
  return (
    <div className={cn("rounded-card bg-surface shadow-1", className)} {...rest}>
      {children}
    </div>
  );
}
