// Settings and Change history skeletons — doc/design/settings.html,
// settings-history.html.
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { SkeletonBlock } from "@/components/ui/skeleton-block";
import { SkButton, SkCard, SkList, SkSectionLabel, SkSwitch, SkeletonPage } from "./parts";

type Control = "input" | "seg" | "value" | "switch" | "button" | "none";

/** `.it` row: label left, control right, min 52px. */
function SettingRow({ labelWidth, control }: { labelWidth: number; control: Control }) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 px-[14px] py-1.5">
      <SkeletonBlock width={labelWidth} height={15} />
      {control === "input" && <SkeletonBlock width={96} height={40} className="rounded-lg" />}
      {control === "seg" && <SkeletonBlock width={110} height={40} className="rounded-[10px]" />}
      {control === "value" && <SkeletonBlock width={70} height={14} />}
      {control === "switch" && <SkSwitch />}
      {control === "button" && <SkeletonBlock width={72} height={40} className="rounded-xl" />}
    </div>
  );
}

/** `.grp`: section label + card list of rows. */
function SettingGroup({
  labelWidth,
  rows,
}: {
  labelWidth: number;
  rows: ReadonlyArray<readonly [number, Control]>;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="ml-1">
        <SkSectionLabel width={labelWidth} />
      </div>
      <SkList>
        {rows.map(([width, control], i) => (
          <SettingRow key={i} labelWidth={width} control={control} />
        ))}
      </SkList>
    </section>
  );
}

/** The Access group (also the Suspense fallback on /settings). */
export function AccessGroupSkeleton() {
  return (
    <SettingGroup
      labelWidth={56}
      rows={[
        [100, "value"],
        [70, "none"],
      ]}
    />
  );
}

export function SettingsSkeleton() {
  return (
    <SkeletonPage label="Loading settings" className="gap-[18px]">
      <BackLink href="/" label="Home" />
      <div className="-mt-2">
        <PageHeader title="Settings" />
      </div>

      {/* Change history link */}
      <SkCard className="flex items-center gap-3 p-[14px]">
        <SkeletonBlock width={20} height={20} className="rounded-full" />
        <div className="flex flex-1 flex-col gap-1">
          <SkeletonBlock width={120} height={15} className="my-[3px]" />
          <SkeletonBlock width={220} height={12} className="my-[2.5px]" />
        </div>
        <SkeletonBlock width={16} height={16} />
      </SkCard>

      {/* Strategy switch */}
      <section className="flex flex-col gap-1.5">
        <div className="ml-1">
          <SkSectionLabel width={70} />
        </div>
        <SkList>
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2.5 p-[14px]">
              <div className="flex flex-col gap-1">
                <SkeletonBlock width={i === 0 ? 180 : 120} height={15} className="my-[3px]" />
                <SkeletonBlock width={250} height={12} className="my-[2.5px]" />
              </div>
              <SkeletonBlock width={156} height={40} className="rounded-[10px]" />
            </div>
          ))}
        </SkList>
        <SkeletonBlock width={280} height={12} className="mx-1 mt-0.5" />
      </section>

      <SettingGroup labelWidth={64} rows={[[140, "input"], [110, "seg"], [110, "value"]]} />
      <SettingGroup labelWidth={110} rows={[[110, "input"], [100, "input"]]} />
      <SettingGroup
        labelWidth={80}
        rows={[[140, "input"], [140, "input"], [150, "input"], [140, "input"]]}
      />
      <SettingGroup
        labelWidth={120}
        rows={[[130, "input"], [170, "input"], [200, "input"], [170, "input"], [180, "input"]]}
      />
      <SettingGroup
        labelWidth={90}
        rows={[[170, "switch"], [130, "switch"], [180, "switch"], [120, "button"]]}
      />
      <AccessGroupSkeleton />

      <SkButton />
    </SkeletonPage>
  );
}

export function SettingsHistorySkeleton() {
  return (
    <SkeletonPage label="Loading change history">
      <BackLink href="/settings" label="Settings" />
      <header className="-mt-2">
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em]">Change history</h1>
        <p className="mt-1 text-[13px] text-muted">
          Every save is kept. Restore puts those values back, and the restore is saved too, so
          you can undo it.
        </p>
      </header>

      <SkList>
        {[
          { changes: [200, 170], restore: false },
          { changes: [180], restore: true },
          { changes: [190, 220], restore: true },
          { changes: [200], restore: true },
        ].map(({ changes, restore }, i) => (
          <div key={i} className="flex flex-col gap-2 p-[14px]">
            <SkeletonBlock width={130} height={12} className="my-[2.5px]" />
            {changes.map((width, j) => (
              <SkeletonBlock key={j} width={width} height={14} className="my-[3px]" />
            ))}
            {restore && <SkeletonBlock width={90} height={40} className="rounded-xl" />}
          </div>
        ))}
      </SkList>
      <SkeletonBlock width={210} height={12} className="mx-auto my-[2.5px]" />
    </SkeletonPage>
  );
}
