import { DoninoWordmark } from "@/components/brand/DoninoMark";
import { productName } from "@/lib/product";

/**
 * The pre-app pages (login, forced password change): the tinted canvas, the «دانینو» wordmark on top — the mark
 * beside the name, the product's own face at the door — and one centred card. A faint icy-blue glow behind the
 * card is the only decoration.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-canvas px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div aria-hidden className="pointer-events-none absolute -top-24 start-1/2 h-72 w-[28rem] -translate-x-1/2 rounded-full bg-info/40 blur-3xl rtl:translate-x-1/2" />
      <div className="relative flex w-full max-w-sm flex-col gap-6">
        <DoninoWordmark name={productName()} size={36} className="justify-center" />
        {children}
      </div>
    </main>
  );
}
