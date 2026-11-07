import type { Metadata } from "next";
import { connection } from "next/server";
import { NewsView } from "@/components/news/news-view";
import { PageHeader } from "@/components/page-header";
import { requireAllowedUser } from "@/lib/auth";
import { getNewsPage } from "@/lib/data";

export const metadata: Metadata = { title: "News" };

export default async function NewsPage() {
  // Live data and the current time: always render at request time.
  await connection();
  await requireAllowedUser();
  const data = await getNewsPage(new Date());
  return (
    <>
      <PageHeader eyebrow="High-impact only · times in Lagos" title="News" />
      <NewsView data={data} />
    </>
  );
}
