import { CircleHelp, LifeBuoy, Presentation, School, Settings2 } from "lucide-react";
import type { Metadata } from "next";
import { ClayIcon } from "@/components/ClayIcon";
import { PageSection } from "@/components/layout/PageSection";
import { PublicBackLink } from "@/components/shell/PublicBackLink";
import { getRequestContext } from "@/lib/ctx";
import { productName } from "@/lib/product";
import { hasTeachingHat } from "@/lib/work-item-words";
import { canAtAnyScope, navRoleFor } from "@/modules/iam/can";

export const metadata: Metadata = { title: "راهنما" };

/**
 * The phase-1 guide: short, friendly Q&A in accordions (`<QA>`), grouped by task for everyone and then by role.
 * Public (linked from /login): without a session every role section is shown; a signed-in reader sees only the
 * sections that match their own hats (a multi-hat person, e.g. an admin who also teaches, sees both).
 */
export default async function HelpPage() {
  const ctx = await getRequestContext();
  const name = productName();
  const showStudent = !ctx || navRoleFor(ctx.assignments) === "student";
  const showTeacher = !ctx || hasTeachingHat(ctx.assignments);
  const showAdmin = !ctx || canAtAnyScope(ctx.assignments, "iam.admin.access");

  return (
    <article className="flex flex-col gap-6 px-4 pt-3 pb-8 md:pt-6">
      <PublicBackLink />
      <header className="flex items-start gap-4">
        <ClayIcon icon={LifeBuoy} size="xl" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-xl font-bold leading-8 text-text">راهنمای {name}</h2>
          <p className="text-sm leading-6 text-text-muted">هرچه لازم دارید بدانید، کوتاه و ساده. روی هر سؤال بزنید تا باز شود.</p>
        </div>
      </header>

      <PageSection id="general" title="برای همه" icon={CircleHelp}>
        <div className="flex flex-col gap-2">
          <QA id="login" question="چطور وارد شوم و رمزم را عوض کنم؟">
            <p>نشانی سامانه را در مرورگر گوشی یا رایانه باز کنید — یا از آیکون {name} روی صفحهٴ اصلی، اگر نصبش کرده‌اید.</p>
            <p>
              شناسهٴ ورودتان شمارهٴ موبایل شماست. دانش‌آموزی که موبایل ندارد یک نام‌کاربری دارد که روی برگهٴ اعتبارنامه‌اش نوشته شده. رمز اولیه را هم از همان برگه یا از مدیر مدرسه بگیرید.
            </p>
            <p>در اولین ورود، سامانه پیش از هر چیز از شما رمز تازه می‌خواهد و تا این کار را نکنید بخش دیگری باز نمی‌شود. بعدها هر وقت خواستید از «بیشتر ← تغییر رمز» رمزتان را عوض کنید.</p>
            <p>روی رایانهٴ مشترک مدرسه، گزینهٴ «این دستگاه عمومی است» را بزنید تا نشست‌تان زودتر (بعد از ۸ ساعت) خودکار بسته شود.</p>
          </QA>
          <QA id="forgot" question="اگر رمزم را فراموش کردم؟">
            <p>خودتان نمی‌توانید رمز فراموش‌شده را از داخل سامانه برگردانید — این کار فقط با مدیر یا معاون مدرسه است. از او بخواهید یک رمز موقت تازه برایتان تعیین کند و با همان وارد شوید.</p>
          </QA>
          <QA id="timetable" question="برنامهٴ هفتگی کجاست؟">
            <p>برنامهٴ هفتگی صفحهٴ جداگانه‌ای ندارد؛ همان‌جایی است که هر روز سر می‌زنید: دانش‌آموز در «کلاس من»، دبیر در «کلاس‌ها». همان‌جا زنگ‌های هر روز را می‌بینید.</p>
          </QA>
          <QA id="notifications" question="اعلان‌ها چطور کار می‌کند؟">
            <p>«اعلان‌ها» خبر هر تغییری روی تکالیف و تسک‌های شماست: مورد تازه، تغییر مهلت، تغییر وضعیت. روی هر اعلان بزنید تا مستقیم به همان مورد بروید.</p>
            <p>اعلان‌ها فقط داخل برنامه‌اند — پیامک یا نوتیفیکیشن گوشی در فاز ۱ نیست، پس بهتر است هر روز یک‌بار سر بزنید.</p>
          </QA>
          <QA id="install" question="نصب روی گوشی (اندروید و آیفون)">
            <p>{name} یک برنامهٴ وب است؛ چیزی از فروشگاهی نصب نمی‌شود.</p>
            <p>
              <strong className="font-semibold text-text">اندروید / کروم:</strong> در خانه کارت «نصب برنامه روی گوشی» را بزنید، یا از منوی مرورگر «افزودن به صفحهٴ اصلی» را انتخاب کنید.
            </p>
            <p>
              <strong className="font-semibold text-text">آیفون / سافاری:</strong> دکمهٴ هم‌رسانی (مربع با فلش) را بزنید و «افزودن به صفحهٴ اصلی» را انتخاب کنید.
            </p>
            <p>بعد از نصب، از همان آیکون روی صفحهٴ اصلی باز کنید — بدون نوار نشانی مرورگر.</p>
          </QA>
        </div>
      </PageSection>

      {showStudent ? (
        <PageSection id="student" title="دانش‌آموز" icon={School}>
          <div className="flex flex-col gap-2">
            <QA id="student-items" question="تکالیف و تسک‌هایم را کجا ببینم؟">
              <p>در خانه، زیر آیکون‌ها، کارت «تکالیف نزدیک» نزدیک‌ترین مهلت‌ها را نشان می‌دهد. «همهٴ تکالیف» در همان کارت فهرست کامل را باز می‌کند: تکلیف‌هایی که دبیرها داده‌اند و تسک‌های شخصی خودتان، کنار هم. این فهرست دو تب دارد — انجام‌نشده و انجام‌شده — و انجام‌نشده‌ها بر پایهٴ مهلت مرتب می‌شوند.</p>
              <p>روی هر مورد بزنید تا جزئیات و مهلتش را ببینید، و وقتی انجامش دادید دکمهٴ «انجام شد» را بزنید. صفحهٴ «کلاس من» هم درس‌ها و برنامهٴ هفتگی‌تان را نشان می‌دهد.</p>
            </QA>
            <QA id="student-new" question="چطور یک تسک شخصی بسازم؟">
              <p>از دکمهٴ «تسک جدید» بالای فهرست تکالیف؛ به این فهرست از «همهٴ تکالیف» در خانه می‌رسید. یک عنوان کوتاه بنویسید و اگر خواستید مهلتی هم برایش بگذارید. این تسک فقط برای خودتان می‌ماند؛ کس دیگری آن را نمی‌بیند.</p>
            </QA>
          </div>
        </PageSection>
      ) : null}

      {showTeacher ? (
        <PageSection id="teacher" title="دبیر" icon={Presentation}>
          <div className="flex flex-col gap-2">
            <QA id="teacher-new" question="چطور تکلیف جدید بدهم؟">
              <p>از دکمهٴ زرد «تکلیف جدید» بالای فهرست تکالیف؛ به این فهرست از «همهٴ تکالیف» در خانه می‌رسید. عنوان کوتاه بنویسید، اولویت و مهلت را تعیین کنید و گیرندگان را انتخاب کنید: یک کلاس (با امکان برداشتن تیک چند نفر) یا فقط خودتان.</p>
              <p>بعد از ارسال، هر دانش‌آموز یک اعلان می‌گیرد و تکلیف در فهرست تکالیف خودش می‌نشیند.</p>
            </QA>
            <QA id="teacher-progress" question="پیشرفت کلاس را از کجا ببینم؟">
              <p>در خانه «همهٴ تکالیف» را بزنید و در فهرست تکالیف، فیلتر «فقط تکالیف داده‌شده» را انتخاب کنید؛ برای هر تکلیف می‌بینید چند دانش‌آموز آن را انجام داده‌اند.</p>
              <p>اگر لازم شد می‌توانید تکلیف را «حذف» کنید — چیزی واقعاً از دست نمی‌رود و هر وقت خواستید با «بازیابی» برش می‌گردانید.</p>
            </QA>
          </div>
        </PageSection>
      ) : null}

      {showAdmin ? (
        <PageSection id="admin" title="مدیر و معاون" icon={Settings2}>
          <div className="flex flex-col gap-2">
            <QA id="admin-structure" question="ساختار مدرسه و کلاس‌ها را از کجا می‌سازم؟">
              <p>سال تحصیلی، مقطع و پایه را لازم نیست بسازید؛ از پیش آماده‌اند: پایه‌های اول تا دوازدهم در سه مقطع (دبستان، متوسطهٴ اول و متوسطهٴ دوم)، و سال تحصیلی جاری و سال بعد با نوبت‌هایشان.</p>
              <p>
                کار شما از «مدیریت» شروع می‌شود: در «کلاس‌ها» کلاس بسازید و پایه‌اش را از فهرست انتخاب کنید. زنگ‌بندی مدرسه — ساعت شروع و پایان هر زنگ — را از صفحهٴ مدرسه تنظیم کنید. بعد روی صفحهٴ هر کلاس، در «ارائهٴ درس‌ها» درس‌ها و دبیرهایش را تعیین کنید و در «برنامهٴ هفتگی» زنگ‌های هفته را بچینید. دانش‌آموزان را در «دانش‌آموزان» و همکاران را در «کارکنان» اضافه کنید.
              </p>
              <p>فهرست درس‌ها برای همهٴ مدرسه‌های سازمان یکی است و مدیر سازمان آن را از «مدرسه‌ها ← درس‌ها» تنظیم می‌کند.</p>
            </QA>
            <QA id="admin-password" question="رمز کسی را فراموش کرده یا حسابش قفل شده؛ چه کنم؟">
              <p>از پروندهٴ همان فرد در «مدیریت»، «تعیین رمز موقت» یا «رفع قفل» را بزنید. رمز موقت فقط همان‌جا و یک‌بار نشان داده می‌شود — همان‌جا یادداشتش کنید و به فرد برسانید.</p>
            </QA>
          </div>
        </PageSection>
      ) : null}
    </article>
  );
}

function QA({ id, question, children }: { id: string; question: string; children: React.ReactNode }) {
  return (
    <details id={id} className="surface-panel">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-text">{question}</summary>
      <div className="flex flex-col gap-2 border-t border-line/70 px-4 py-3 text-sm leading-7 text-text-muted">{children}</div>
    </details>
  );
}
