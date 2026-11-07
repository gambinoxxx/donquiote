// Red news banner (doc/design/news.html `.news-banner`): Home and /news.
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { NewsBanner as Banner } from "@/lib/news/warnings";

export function NewsBanner({ banner, link = true }: { banner: Banner | null; link?: boolean }) {
  if (!banner) return null;
  const body = (
    <>
      <TriangleAlert className="h-[22px] w-[22px] flex-none text-news" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-news-title">{banner.title}</p>
        <p className="mt-0.5 text-[13px] break-words">{banner.detail}</p>
      </div>
    </>
  );
  const cls = "flex items-center gap-3 rounded-2xl border border-news bg-news p-3.5 text-news-body no-underline";
  return link ? (
    <Link href={banner.kind === "headline" ? "/news#headlines" : "/news"} role="status" className={cls}>
      {body}
    </Link>
  ) : (
    <div role="status" className={cls}>
      {body}
    </div>
  );
}

/** Alert detail: news near this alert. Warns only. */
export function NewsWarning({ text }: { text: string }) {
  return (
    <Link href="/news" role="note" className="flex items-start gap-3 rounded-2xl border border-news bg-news p-3.5 text-sm text-news-body no-underline">
      <TriangleAlert className="mt-0.5 h-5 w-5 flex-none text-news" aria-hidden="true" />
      <span>
        <span className="font-bold text-news-title">News warning. </span>
        {text} You decide.
      </span>
    </Link>
  );
}
