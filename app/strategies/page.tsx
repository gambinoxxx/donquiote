import type { Metadata } from "next";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { StrategyCards } from "@/components/settings/strategy-cards";
import { requireAllowedUser } from "@/lib/auth";
import { getStrategiesPage } from "@/lib/data";

export const metadata: Metadata = { title: "Strategies" };

export default async function StrategiesPage() {
  await connection();
  await requireAllowedUser();
  const data = await getStrategiesPage();
  return (
    <div className="flex flex-col gap-4">
      <BackLink href="/" label="Home" />
      <h1 className="-mt-2 text-[28px] leading-tight font-bold tracking-[-0.02em]">Strategies</h1>
      <StrategyCards key={data.versionId ?? "none"} strategies={data.strategies} versionId={data.versionId} />
    </div>
  );
}
