import { DoninoMark3D } from "@/components/brand/DoninoMark3D";
import { cn } from "@/lib/cn";
import { productName } from "@/lib/product";

/**
 * The brand half of the auth door (mock docs/mockups/login-v6.html `.brand`): the glass «D» (`DoninoMark3D`), the
 * wordmark and one line. `login`: 170 px art + «مدرسه‌تان، یک‌جا» on phones (smaller on short screens), 330 px art +
 * the one sentence about the product on desktop — no role facts. `compact`: the password page's small art + the
 * phone line at every width. Not a heading: the page's h1 is the card's title.
 */
export function AuthBrand({ variant = "login", className }: { variant?: "login" | "compact"; className?: string }) {
  const login = variant === "login";
  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <DoninoMark3D
        className={
          login
            ? "size-[10.625rem] [@media(max-height:42rem)]:size-32 lg:size-[20.625rem] lg:[@media(max-height:42rem)]:size-60"
            : "size-28"
        }
      />
      <p className={cn("mt-1.5 font-extrabold text-(--auth-text)", login ? "text-display lg:mt-4 lg:text-wordmark" : "text-title")}>{productName()}</p>
      <p className={cn("mt-0.5 text-sm text-(--auth-muted)", login && "lg:hidden")}>مدرسه‌تان، یک‌جا</p>
      {login ? (
        <p className="mt-3 hidden max-w-[22.5rem] text-base text-(--auth-muted) lg:block">تکالیف، حضور و غیاب، کارنامه و مشاوره؛ همهٴ کار مدرسه در یک‌جا.</p>
      ) : null}
    </div>
  );
}
