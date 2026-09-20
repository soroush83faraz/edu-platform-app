import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumberFa } from "@/lib/format";

/** Title row of every admin page: optional back link, title, description, actions on the end side. */
export function AdminHeader({ title, description, back, actions }: { title: string; description?: string; back?: { href: string; label: string }; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      {back ? (
        <Link href={back.href} className="inline-flex min-h-9 items-center gap-1 self-start text-sm text-text-muted hover:text-text">
          <ArrowRight className="size-4" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-text">{title}</h2>
          {description ? <p className="mt-1 max-w-prose text-sm text-text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** GET form: `?q=` search that keeps the other query parameters. */
export function SearchForm({ q, hidden, placeholder = "جست‌وجو…" }: { q: string; hidden?: Record<string, string | undefined>; placeholder?: string }) {
  return (
    <form method="get" role="search" className="relative">
      {Object.entries(hidden ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-faint" aria-hidden />
      <Input name="q" defaultValue={q} placeholder={placeholder} aria-label="جست‌وجو" className="h-11 bg-surface ps-9" enterKeyHint="search" />
    </form>
  );
}

/** «قبلی / بعدی» links with the count; hidden when everything fits on one page. */
export function Pagination({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="صفحه‌بندی" className="flex items-center justify-between gap-3 text-sm text-text-muted">
      <Button asChild variant="outline" className="h-10" aria-disabled={page <= 1}>
        <Link href={href(Math.max(1, page - 1))} aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-50" : ""}>
          قبلی
        </Link>
      </Button>
      <span className="tabular">
        صفحهٴ {formatNumberFa(page)} از {formatNumberFa(pages)} · {formatNumberFa(total)} مورد
      </span>
      <Button asChild variant="outline" className="h-10" aria-disabled={page >= pages}>
        <Link href={href(Math.min(pages, page + 1))} aria-disabled={page >= pages} className={page >= pages ? "pointer-events-none opacity-50" : ""}>
          بعدی
        </Link>
      </Button>
    </nav>
  );
}
