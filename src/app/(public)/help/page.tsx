import { Bell, ClipboardPlus, Inbox, KeyRound, LifeBuoy, LogIn, type LucideIcon, Settings2, Smartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClayIcon } from "@/components/ClayIcon";
import { RowMark } from "@/components/RowMark";
import { PublicBackLink } from "@/components/shell/PublicBackLink";
import { getRequestContext } from "@/lib/ctx";
import { productName } from "@/lib/product";
import { canAtAnyScope } from "@/modules/iam/can";

export const metadata: Metadata = { title: "راهنما | سامانهٴ مدرسه" };

interface Topic {
  id: string;
  icon: LucideIcon;
  title: string;
  /** Who the section is for — shown as a small caption. */
  audience: string;
}

const TOPICS: Topic[] = [
  { id: "login", icon: LogIn, title: "ورود به سامانه", audience: "همه" },
  { id: "password", icon: KeyRound, title: "تغییر رمز در اولین ورود", audience: "همه" },
  { id: "inbox", icon: Inbox, title: "پنل من", audience: "دانش‌آموزان و کادر" },
  { id: "new-item", icon: ClipboardPlus, title: "تکلیف جدید", audience: "دبیران و مدیران" },
  { id: "notifications", icon: Bell, title: "اعلان‌ها", audience: "همه" },
  { id: "admin", icon: Settings2, title: "مدیریت مدرسه", audience: "مدیر و معاون" },
  { id: "install", icon: Smartphone, title: "نصب روی گوشی", audience: "همه" },
];

/**
 * The phase-1 guide: one card per topic, anchored (`/help#inbox`), with the clay marks of the product. Public
 * (linked from /login): without a session every topic is shown, each with its audience caption; a signed-in
 * reader sees only the topics of their roles.
 */
export default async function HelpPage() {
  const ctx = await getRequestContext();
  const name = productName();
  const canCreate = ctx ? canAtAnyScope(ctx.assignments, "workspace.work_item.create") : true;
  const isAdmin = ctx ? canAtAnyScope(ctx.assignments, "iam.admin.access") : true;
  const topics = TOPICS.filter((t) => (t.id === "new-item" ? canCreate : t.id === "admin" ? isAdmin : true));

  return (
    <article className="flex flex-col gap-5 px-4 pt-3 pb-8 md:pt-6">
      <PublicBackLink />
      <header className="flex items-start gap-4">
        <ClayIcon icon={LifeBuoy} size="xl" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-xl font-bold leading-8 text-text">راهنمای {name}</h2>
          <p className="text-sm leading-6 text-text-muted">
            کوتاه و به ترتیب کار: از ورود تا نصب روی گوشی.{ctx ? " بخش‌هایی که به نقش شما مربوط نیست نشان داده نمی‌شود." : " زیر عنوان هر بخش نوشته شده برای کدام نقش است."}
          </p>
        </div>
      </header>

      <nav aria-label="فهرست راهنما">
        <ul className="flex flex-wrap gap-2">
          {topics.map((t) => (
            <li key={t.id}>
              <a href={`#${t.id}`} className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm text-text-muted transition-base hover:border-line-strong hover:text-text">
                {t.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Topic topic={TOPICS[0]}>
        <Steps>
          <li>نشانی سامانه را در مرورگر گوشی یا رایانه باز کنید (یا از نشان برنامه روی صفحهٴ اصلی).</li>
          <li>
            <strong className="font-semibold">شناسهٴ ورود</strong> شمارهٴ موبایل شماست (مثل <bdi dir="ltr">۰۹۱۲۱۲۳۴۵۶۷</bdi>). دانش‌آموزی که موبایل ندارد نام‌کاربری‌ای مثل <bdi dir="ltr">alk-14051001</bdi> دارد که روی برگهٴ اعتبارنامه‌اش نوشته شده است. ارقام فارسی و انگلیسی هر دو پذیرفته می‌شوند.
          </li>
          <li>رمز اولیه را از برگهٴ اعتبارنامه یا از مدیر مدرسه بگیرید.</li>
          <li>روی دستگاه مشترک (رایانهٴ مدرسه) گزینهٴ «این دستگاه عمومی است» را بزنید تا نشست بعد از ۸ ساعت خودکار پایان یابد.</li>
        </Steps>
        <Note>پس از چند بار رمز اشتباه، ورود برای مدتی بسته می‌شود و پیام کلی نشان داده می‌شود. اگر حسابتان قفل شد، مدیر مدرسه از پروندهٴ شما «رفع قفل» می‌کند یا رمز موقت تازه می‌دهد.</Note>
      </Topic>

      <Topic topic={TOPICS[1]}>
        <p>در اولین ورود (و هر بار که مدیر رمز موقت بدهد) سامانه پیش از هر چیز صفحهٴ «تغییر رمز» را نشان می‌دهد و تا رمز را تغییر ندهید هیچ بخش دیگری باز نمی‌شود.</p>
        <Steps>
          <li>رمز اولیه را در «رمز فعلی» بنویسید.</li>
          <li>رمز جدیدی با دست‌کم ۸ نویسه انتخاب کنید که با شماره یا نام‌کاربری‌تان یکی نباشد و تکراری یا ترتیبی (مثل ۱۲۳۴۵۶۷۸) نباشد.</li>
          <li>رمز جدید را در «تکرار رمز» دوباره بنویسید و ذخیره کنید. نشست‌های دیگرِ حسابتان به‌طور خودکار خارج می‌شوند.</li>
        </Steps>
        <Note>
          بعداً می‌توانید از «بیشتر ← تغییر رمز» رمز را عوض کنید. رمز فراموش‌شده را فقط مدیر مدرسه با «تعیین رمز موقت» بازنشانی می‌کند.
        </Note>
      </Topic>

      <Topic topic={TOPICS[2]}>
        <p>
          <Link href="/inbox" className="font-semibold text-primary-700 hover:underline">
            پنل من
          </Link>{" "}
          فهرست تکالیف شماست: تکلیف‌هایی که دبیر یا کادر مدرسه داده، و یادداشت‌های شخصی خودتان.
        </p>
        <ul className="list-disc space-y-1 ps-5">
          <li>
            دو تب دارد: <strong className="font-semibold">انجام‌نشده</strong> و <strong className="font-semibold">انجام‌شده</strong>. تکالیف انجام‌نشده بر پایهٴ مهلت گروه می‌شوند: سررسیده، امروز، این هفته، بعداً، بدون مهلت.
          </li>
          <li>روی هر تکلیف بزنید تا جزئیات، توضیح، مهلت و گفت‌وگو را ببینید. تکلیف خوانده‌شده حساب می‌شود و نشان عدد روی «پنل من» کم می‌شود.</li>
          <li>
            وقتی تکلیفی را انجام دادید دکمهٴ <strong className="font-semibold">«انجام شد»</strong> را بزنید؛ دبیر همان لحظه اعلان می‌گیرد و پیشرفت کلاس را می‌بیند.
          </li>
          <li>در بخش «گفت‌وگو» می‌توانید نظر بنویسید — مثلاً «انجام دادم، فقط سؤال ۳ را نفهمیدم». نظر شما روی تکلیف کلاسی فقط برای دبیر و کادر مدرسه دیده می‌شود، نه هم‌کلاسی‌ها.</li>
          <li>از «گزینه‌های بیشتر» می‌توانید تکلیفی را به بالای فهرست سنجاق کنید یا از پنل خودتان بایگانی کنید؛ تکلیف برای دیگران دست‌نخورده می‌ماند.</li>
        </ul>
        <Note>دبیران زیر فهرست، فیلتر «فقط تکالیف داده‌شده» را دارند و برای هر تکلیف می‌بینند چند نفر آن را انجام داده‌اند.</Note>
      </Topic>

      {canCreate ? (
        <Topic topic={TOPICS[3]}>
          <p>
            از دکمهٴ زردِ{" "}
            <Link href="/inbox/new" className="font-semibold text-primary-700 hover:underline">
              «تکلیف جدید»
            </Link>{" "}
            در خانه یا بالای پنل من.
          </p>
          <Steps>
            <li>عنوان کوتاه و روشن بنویسید (مثل «تمرین صفحهٴ ۴۲»)؛ توضیح اختیاری است.</li>
            <li>اولویت را انتخاب کنید. «فوری» و «بالا» با نشان زرد در فهرست گیرندگان دیده می‌شود.</li>
            <li>
              مهلت را با دکمه‌های «امروز / فردا / هفتهٴ بعد» یا به شکل <bdi dir="ltr">۱۴۰۵/۰۷/۰۵</bdi> بدهید؛ بدون ساعت، پایان همان روز (۲۳:۵۹) حساب می‌شود. مهلتِ گذشته مجاز است اما هشدار می‌گیرد.
            </li>
            <li>
              گیرندگان: <strong className="font-semibold">کلاس</strong> (درسِ خودتان؛ می‌توانید تیک چند نفر را بردارید)، <strong className="font-semibold">اشخاص</strong> (فقط مدیران: جست‌وجوی نام) یا <strong className="font-semibold">خودم</strong> (یادداشت شخصی که فقط در پنل خودتان می‌ماند).
            </li>
            <li>«ارسال» بزنید. هر گیرنده یک اعلان و یک ردیف در پنلش می‌گیرد؛ شما تکلیف را زیر «فقط تکالیف داده‌شده» با پیشرفت هر نفر می‌بینید.</li>
          </Steps>
          <Note>روی صفحهٴ تکلیف می‌توانید آن را «لغو» کنید (با تأیید) یا تکلیف انجام‌شده را «بازگشایی» کنید. با تیک «فقط برای کادر مدرسه» نظری می‌نویسید که دانش‌آموزان نمی‌بینند.</Note>
        </Topic>
      ) : null}

      <Topic topic={TOPICS[4]}>
        <p>
          <Link href="/notifications" className="font-semibold text-primary-700 hover:underline">
            اعلان‌ها
          </Link>{" "}
          خبرِ هر تغییر روی تکالیف شماست: تکلیف جدید، نظر تازه، تغییر وضعیت. روی هر اعلان بزنید تا به همان تکلیف بروید؛ «همه را خوانده‌شده کن» فقط وقتی اعلان نخوانده دارید نشان داده می‌شود. اعلان‌ها فقط درون برنامه‌اند — پیامک یا نوتیفیکیشن گوشی در فاز ۱ نیست، پس هر روز یک بار سر بزنید.
        </p>
      </Topic>

      {isAdmin ? (
        <Topic topic={TOPICS[5]}>
          <p>
            <Link href="/admin" className="font-semibold text-primary-700 hover:underline">
              مدیریت
            </Link>{" "}
            ساختار مدرسه و افراد را نگه می‌دارد. ترتیب راه‌اندازی همان ترتیب چیپ‌های بالای صفحه است؛ صفحهٴ «راه‌اندازی مدرسه» (فقط برای مدیر سازمان، که مدرسه‌ها را تعریف می‌کند) چک‌لیست پیشرفت را نشان می‌دهد.
          </p>
          <ul className="list-disc space-y-1 ps-5">
            <li>
              <strong className="font-semibold">ساختار</strong>: مدرسه (فقط مدیر سازمان می‌سازد) ← سال تحصیلی و نوبت‌ها ← مقطع، پایه و درس (کاتالوگ سازمان) ← کلاس‌ها ← روی هر کلاس «ارائهٴ درس‌ها»: درس × نوبت × دبیر اصلی. تعیین دبیر همان‌جا نقش «معلم» را برای آن کلاس‌درس می‌دهد؛ معاون فقط دبیر را تغییر می‌دهد.
            </li>
            <li>
              <strong className="font-semibold">دانش‌آموزان و کارکنان</strong>: ثبت با یک فرم (شخص + حساب + کلاس). رمز اولیه فقط یک بار نشان داده می‌شود؛ بعداً از صفحهٴ کلاس «چاپ اعتبارنامه‌ها» را بزنید: برگه‌های بریدنی با شناسهٴ ورود و رمز اولیه تا وقتی که هنوز تغییر نکرده است.
            </li>
            <li>
              <strong className="font-semibold">پروندهٴ فرد</strong>: ویرایش مشخصات، «تعیین رمز موقت» (همهٴ نشست‌های او خارج می‌شود)، «رفع قفل»، ثبت‌نام یا انتقال کلاس، نقش‌ها و تدریس.
            </li>
            <li>
              <strong className="font-semibold">جست‌وجو</strong> با نام یا شمارهٴ دانش‌آموزی، با ارقام فارسی یا انگلیسی. ورود گروهی از اکسل فعلاً از خط فرمان و به دست تیم فنی انجام می‌شود.
            </li>
          </ul>
          <Note>مدیر مدرسه فقط مدرسه‌های خودش را می‌بیند و فقط نقش «معاون» می‌دهد؛ نقش مدیر مدرسه با مدیر سازمان است.</Note>
        </Topic>
      ) : null}

      <Topic topic={TOPICS[6]}>
        <p>{name} یک برنامهٴ وب قابل نصب است؛ چیزی از فروشگاه دانلود نمی‌شود.</p>
        <ul className="list-disc space-y-1 ps-5">
          <li>
            <strong className="font-semibold">اندروید / کروم</strong>: در صفحهٴ خانه کارت «نصب برنامه روی گوشی» را بزنید، یا از منوی مرورگر «افزودن به صفحهٴ اصلی» را انتخاب کنید.
          </li>
          <li>
            <strong className="font-semibold">آیفون / سافاری</strong>: دکمهٴ هم‌رسانی (مربع با فلش) ← «افزودن به صفحهٴ اصلی» ← «افزودن».
          </li>
        </ul>
        <Note>برنامه هیچ داده‌ای روی گوشی نگه نمی‌دارد؛ بدون اینترنت فقط صفحهٴ «اتصال برقرار نیست» را می‌بینید و با «خروج» همه‌چیز از دستگاه پاک می‌شود — پس روی گوشی مشترک همیشه خروج کنید.</Note>
      </Topic>
    </article>
  );
}

function Topic({ topic, children }: { topic: Topic; children: React.ReactNode }) {
  return (
    <section id={topic.id} aria-labelledby={`${topic.id}-title`} className="flex scroll-mt-20 flex-col gap-3 surface-work p-4">
      <div className="flex items-center gap-3">
        <RowMark icon={topic.icon} />
        <div className="flex flex-col">
          <h3 id={`${topic.id}-title`} className="text-base font-semibold text-text">
            {topic.title}
          </h3>
          <span className="text-meta text-text-muted">{topic.audience}</span>
        </div>
      </div>
      <div className="flex flex-col gap-2 text-sm leading-7 text-text">{children}</div>
    </section>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-1 ps-5 marker:text-text-muted">{children}</ol>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-surface-sunken px-3 py-2 text-sm leading-6 text-text-muted">{children}</p>;
}
