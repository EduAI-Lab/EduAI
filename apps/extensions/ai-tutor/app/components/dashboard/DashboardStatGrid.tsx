import { StatCard } from '@eduai/ui';

export type DashboardStat = {
  label: string;
  value: string | number;
  trend?: number;
  trendLabel?: string;
};

type DashboardStatGridProps = {
  stats: DashboardStat[];
};

export function DashboardStatGrid({ stats }: DashboardStatGridProps) {
  if (stats.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {stats.map((stat) => (
        <StatCard
          key={stat.label}
          label={stat.label}
          value={stat.value}
          trend={stat.trend}
          trendLabel={stat.trendLabel}
        />
      ))}
    </div>
  );
}
