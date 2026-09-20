import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireContext } from "@/lib/ctx";
import { formatJalaliLong, formatNumberFa } from "@/lib/format";
import { logoutAction, logoutAllAction } from "@/modules/iam/actions";
import { countPersonsInOrg } from "@/modules/iam/queries";

export default async function HomePage() {
  const ctx = await requireContext(); // the (app) layout already redirected anonymous visitors
  const persons = await countPersonsInOrg(); // FORBIDDEN for roles without org-level person.read → simply hidden

  return (
    <div className="flex flex-col gap-4 p-4">
      <section className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold">
          سلام، <bdi>{ctx.firstName}</bdi>
        </h2>
        <p className="text-muted-foreground">{formatJalaliLong()}</p>
        <p className="text-sm text-muted-foreground">
          {ctx.orgName}
          {ctx.schoolName ? ` · ${ctx.schoolName}` : ""}
        </p>
      </section>

      {persons.ok ? (
        <Card>
          <CardContent className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">افراد ثبت‌شده در سازمان</span>
            <span className="text-2xl font-bold tabular-nums">{formatNumberFa(persons.data)}</span>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <form action={logoutAction}>
          <Button type="submit" variant="outline" className="h-11">
            خروج
          </Button>
        </form>
        <form action={logoutAllAction}>
          <Button type="submit" variant="ghost" className="h-11">
            خروج از همهٴ دستگاه‌ها
          </Button>
        </form>
      </div>
    </div>
  );
}
