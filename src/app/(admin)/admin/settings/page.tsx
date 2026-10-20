import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Chip } from "@/components/Chip";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageSection } from "@/components/layout/PageSection";
import { Button } from "@/components/ui/button";
import { SelectNative } from "@/components/ui/select-native";
import { settingsPageQuery } from "@/modules/config/queries";
import type { FlagSource } from "@/modules/config/flags";
import type { SettingSource } from "@/modules/config/settings";
import { FlagControl, SettingControl } from "@/modules/config/ui/SettingsControls";

export const metadata: Metadata = { title: "تنظیمات | مدیریت" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

const SOURCE_FA: Record<FlagSource | SettingSource, { org: string; school: string }> = {
  default: { org: "پیش‌فرض", school: "پیش‌فرض" },
  organization: { org: "تنظیم سازمان", school: "از سازمان" },
  school: { org: "تنظیم سازمان", school: "تنظیم این مدرسه" },
};

/**
 * «تنظیمات» (owner, 2026-10-20; docs/decisions.md «صف، زمان‌بند و Feature Flag»): the organization's feature switches
 * («قابلیت‌ها») and settings, one level at a time. The organization admin edits the organization's values and, with
 * `?school=<id>`, a school's overrides; a principal / vice principal sees only their school(s) and only the keys a
 * school may override. A GET form picks the level (the URL is the state); each row saves on its own and every change
 * is audited. `settingsPageQuery` decides the scope — a school outside it is a 404.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const schoolParam = one(sp.school);
  if (schoolParam && !UUID_RE.test(schoolParam)) notFound();
  const result = await settingsPageQuery({ schoolId: schoolParam || null });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const view = result.data;
  const atSchool = view.schoolId !== null;
  const level = view.levels.find((l) => l.schoolId === view.schoolId);
  const inheritLabel = atSchool ? "پیروی از سازمان" : "پیش‌فرض";
  const sourceText = (s: FlagSource | SettingSource) => (atSchool ? SOURCE_FA[s].school : SOURCE_FA[s].org);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="تنظیمات"
        description={
          atSchool
            ? `قابلیت‌ها و تنظیمات «${level?.name ?? ""}». هرچه این‌جا تنظیم نشود از سازمان پیروی می‌کند.`
            : "قابلیت‌ها و تنظیمات همهٴ مدرسه‌های سازمان. هر مدرسه می‌تواند بعضی از آن‌ها را برای خودش تغییر دهد."
        }
      />

      {view.levels.length > 1 ? (
        <form method="get" className="surface-panel flex flex-wrap items-end gap-2 p-3">
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-meta text-text-muted">
            سطح
            <SelectNative name="school" defaultValue={view.schoolId ?? ""} aria-label="سطح تنظیمات" className="h-11">
              {view.levels.map((l) => (
                <option key={l.schoolId ?? "org"} value={l.schoolId ?? ""}>
                  {l.schoolId === null ? `سازمان — ${l.name}` : l.name}
                </option>
              ))}
            </SelectNative>
          </label>
          <Button type="submit" variant="outline" className="h-11">
            نمایش
          </Button>
        </form>
      ) : null}

      <PageSection id="flags" title="قابلیت‌ها" surface="work" flush>
        {view.flags.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">قابلیتی برای تنظیم در این مدرسه نیست.</p>
        ) : (
          <ul className="divide-y divide-line/70">
            {view.flags.map((f) => (
              <li key={f.key} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-row font-medium text-text">{f.labelFa}</span>
                    <Chip tone={f.enabled ? "primary" : "neutral"}>{f.enabled ? "روشن" : "خاموش"}</Chip>
                    <span className="text-meta text-text-muted">{sourceText(f.source)}</span>
                    {f.upcoming ? <Chip>به‌زودی</Chip> : null}
                  </span>
                  <span className="text-meta text-text-muted">{f.descriptionFa}</span>
                </div>
                <FlagControl key={`${view.schoolId ?? "org"}:${f.key}`} flagKey={f.key} label={f.labelFa} schoolId={view.schoolId} own={f.own} inherited={f.inherited} inheritLabel={inheritLabel} />
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection id="settings" title="تنظیمات مدرسه" surface="panel" flush>
        {view.settings.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">تنظیمی برای این مدرسه نیست.</p>
        ) : (
          <ul className="divide-y divide-line/70">
            {view.settings.map((s) => (
              <li key={s.key} className="flex flex-col gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-row font-medium text-text">{s.labelFa}</span>
                    <span className="text-meta text-text-muted">{sourceText(s.source)}</span>
                    {s.upcoming ? <Chip>به‌زودی</Chip> : null}
                  </span>
                  <span className="text-meta text-text-muted">{s.descriptionFa}</span>
                </div>
                <SettingControl
                  key={`${view.schoolId ?? "org"}:${s.key}`}
                  settingKey={s.key}
                  label={s.labelFa}
                  schoolId={view.schoolId}
                  kind={s.kind}
                  unitFa={s.unitFa}
                  min={s.min}
                  max={s.max}
                  own={s.own}
                  inherited={s.inherited}
                  inheritLabel={inheritLabel}
                />
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </div>
  );
}
