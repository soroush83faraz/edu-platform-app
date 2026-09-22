import { Building2, Eye, FileText, Globe, ListChecks, type LucideIcon, MapPin, Pencil, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { ClayIcon } from "@/components/ClayIcon";
import { RowMark } from "@/components/RowMark";
import { PublicBackLink } from "@/components/shell/PublicBackLink";
import { productName } from "@/lib/product";

export const metadata: Metadata = { title: "حریم خصوصی | سامانهٴ مدرسه" };

/**
 * The privacy notice of phase 1 — the client's own text (edu-platform-architecture/docs/client/06-etelaieh-harim-
 * khosoosi.md) adapted to a web page: what is stored, why, who sees it, where, external services, who owns it,
 * how to ask for a correction. The school is the data owner; the contact line is what the school configures.
 * Public: readable before signing in (linked from /login).
 */
export default function PrivacyPage() {
  const name = productName();
  return (
    <article className="flex flex-col gap-5 px-4 pt-3 pb-8 md:pt-6">
      <PublicBackLink />
      <header className="flex items-start gap-4">
        <ClayIcon icon={ShieldCheck} size="xl" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-xl font-bold leading-8 text-text">اطلاعیهٴ حریم خصوصی</h2>
          <p className="text-sm leading-6 text-text-muted">این صفحه به زبان ساده می‌گوید {name} چه اطلاعاتی از شما نگه می‌دارد و با آن‌ها چه می‌کند. نسخهٴ فاز ۱ — شهریور ۱۴۰۵.</p>
        </div>
      </header>

      <Section icon={FileText} title="چه اطلاعاتی ثبت می‌شود">
        <ul className="list-disc space-y-1 ps-5">
          <li>نام و نام خانوادگی</li>
          <li>کلاس (و پایه و مدرسه)</li>
          <li>شمارهٴ دانش‌آموزی (برای دانش‌آموزان) یا شمارهٴ کارمندی (برای همکاران، اختیاری)</li>
          <li>یک شمارهٴ موبایل یا نام‌کاربری برای ورود، و رمز ورود که فقط به شکل هش‌شده نگه داشته می‌شود</li>
          <li>شمارهٴ تماس ولی (در صورت وجود)</li>
          <li>آنچه خودتان در سامانه می‌نویسید: تکالیف، یادداشت‌ها، نظرها و وضعیت انجام آن‌ها</li>
          <li>زمان و دستگاه ورود (برای امنیت حساب و رفع قفل)</li>
        </ul>
        <p>هیچ اطلاعات دیگری — مثل کد ملی، تاریخ تولد، نشانی خانه یا عکس — در فاز ۱ ثبت نمی‌شود.</p>
      </Section>

      <Section icon={ListChecks} title="برای چه استفاده می‌شود">
        <p>فقط برای این‌که هر نفر بتواند وارد {name} شود، کارهای کلاسی خودش را ببیند و انجام دهد، و مدرسه بتواند کلاس‌ها، دبیران و کاربران را مدیریت کند. هیچ استفادهٴ تبلیغاتی یا تحلیلی از اطلاعات نمی‌شود.</p>
      </Section>

      <Section icon={Eye} title="چه کسی می‌بیند">
        <ul className="list-disc space-y-1 ps-5">
          <li>
            <strong className="font-semibold text-text">خودِ شما</strong>: مشخصات، تکالیف و نظرهای خودتان.
          </li>
          <li>
            <strong className="font-semibold text-text">دبیران کلاس شما</strong>: نام و کلاس شما، وضعیت انجام تکالیفی که خودشان داده‌اند و نظرهایتان روی آن‌ها.
          </li>
          <li>
            <strong className="font-semibold text-text">مدیریت مدرسه</strong> (مدیر و معاون): مشخصات، حساب کاربری و ثبت‌نام‌های افراد همان مدرسه.
          </li>
        </ul>
        <p>اطلاعات هیچ دانش‌آموز یا کلاسی به مدرسهٴ دیگری نشان داده نمی‌شود؛ هر مدرسه داده‌های خودش را می‌بیند. نظری که یک دانش‌آموز روی تکلیف کلاسی می‌گذارد فقط برای دبیر و کادر مدرسه دیده می‌شود، نه هم‌کلاسی‌ها.</p>
      </Section>

      <Section icon={MapPin} title="کجا نگهداری می‌شود">
        <p>روی سروری که داخل ایران قرار دارد. برنامه روی گوشی هیچ داده‌ای را ذخیره نمی‌کند؛ با خروج از حساب، همه‌چیز از دستگاه پاک می‌شود.</p>
      </Section>

      <Section icon={Globe} title="چه سرویس‌های بیرونی درگیرند">
        <p>هیچ. در فاز ۱ هیچ سرویس بیرونی — تبلیغاتی، تحلیلی، فونت یا نقشه — با اطلاعات شما در ارتباط نیست و هیچ داده‌ای به خارج از سرور مدرسه فرستاده نمی‌شود.</p>
      </Section>

      <Section icon={Building2} title="مالک داده">
        <p>مدرسه مالک این اطلاعات است و دربارهٴ ثبت، اصلاح و حذف آن‌ها تصمیم می‌گیرد. سازندهٴ سامانه فقط نگه‌دارندهٴ فنی است.</p>
      </Section>

      <Section icon={Pencil} title="حق درخواست اصلاح یا حذف">
        <p>اگر اطلاعات ثبت‌شدهٴ شما اشتباه است یا می‌خواهید حذف شود، از طریق مدیریت مدرسه درخواست بدهید: حضوری، یا با شماره و نشانی‌ای که مدرسه اعلام کرده است. مدیر مدرسه می‌تواند مشخصات را همان‌جا اصلاح کند.</p>
        <p className="text-text-muted">راه تماس با مدیریت مدرسه: <span className="text-text-faint">[مدرسه این بخش را تکمیل می‌کند]</span></p>
      </Section>
    </article>
  );
}

function Section({ icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 surface-work p-4">
      <h3 className="flex items-center gap-3 text-base font-semibold text-text">
        <RowMark icon={icon} />
        {title}
      </h3>
      <div className="flex flex-col gap-2 text-sm leading-7 text-text">{children}</div>
    </section>
  );
}
