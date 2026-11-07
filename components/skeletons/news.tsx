// News skeleton — doc/design/news.html (Calendar tab, the default).
import { PageHeader } from "@/components/page-header";
import { SkeletonBlock } from "@/components/ui/skeleton-block";
import { SkList, SkListRow, SkeletonPage } from "./parts";

export function NewsSkeleton() {
  return (
    <SkeletonPage label="Loading news">
      <PageHeader eyebrow="High-impact only · times in Lagos" title="News" />
      {/* Calendar / Headlines tabs */}
      <SkeletonBlock height={48} className="w-full rounded-[10px]" />
      {/* Currency chips */}
      <div className="flex gap-2">
        {[44, 52, 52, 52, 52, 52].map((width, i) => (
          <SkeletonBlock key={i} width={width} height={36} className="rounded-[18px]" />
        ))}
      </div>
      {[3, 2].map((rows, g) => (
        <div key={g} className="flex flex-col gap-2">
          <SkeletonBlock width={130} height={12} className="my-[2.5px] ml-1" />
          <SkList>
            {Array.from({ length: rows }, (_, i) => (
              <SkListRow key={i}>
                <SkeletonBlock width={40} height={14} />
                <div className="flex flex-1 flex-col gap-[6px]">
                  <SkeletonBlock width={170} height={16} />
                  <SkeletonBlock width={140} height={12} />
                </div>
              </SkListRow>
            ))}
          </SkList>
        </div>
      ))}
    </SkeletonPage>
  );
}
