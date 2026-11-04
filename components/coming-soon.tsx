import { Card, CardContent } from "@/components/ui/card";

interface ComingSoonProps {
  unit: number;
  /** What this screen will show once the unit is built. */
  description: string;
}

/** Placeholder card for screens whose real content arrives in a later unit. */
export function ComingSoon({ unit, description }: ComingSoonProps) {
  return (
    <Card className="rounded-2xl border border-default bg-surface ring-0">
      <CardContent className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
          Coming in Unit {unit}
        </p>
        <p className="text-sm text-muted">{description}</p>
      </CardContent>
    </Card>
  );
}
