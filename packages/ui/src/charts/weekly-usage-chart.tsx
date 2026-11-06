/**
 * Weekly usage line chart for the admin dashboards (Core's AI chats, AI
 * Tutor's tutoring sessions). A subpath export (`@eduai/ui/weekly-usage-chart`)
 * so each app can lazy-load it: recharts is large and nothing else on the page
 * needs it (#1223).
 *
 * Colours are theme tokens, so the chart follows the light/dark switch like the
 * donuts do.
 */
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** One week's count; `weekStart` is the Monday, as YYYY-MM-DD (UTC). */
export type WeeklyUsagePoint = { weekStart: string; count: number };

const LINE_COLOR = "var(--primary)";
const GRID_COLOR = "var(--border)";
const TICK_COLOR = "var(--muted-foreground)";

function monthLabel(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

function weekLabel(weekStart: string): string {
  return `Week of ${new Date(`${weekStart}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })}`;
}

/** Label only the first week of each month, so the axis reads Jun, Jul, Aug… */
function monthTicks(data: WeeklyUsagePoint[]): string[] {
  const ticks: string[] = [];
  let lastMonth = "";
  for (const point of data) {
    const month = point.weekStart.slice(0, 7);
    if (month !== lastMonth) {
      ticks.push(point.weekStart);
      lastMonth = month;
    }
  }
  return ticks;
}

export default function WeeklyUsageChart({
  data,
  seriesLabel,
}: {
  data: WeeklyUsagePoint[];
  /** What a point counts, for the tooltip (e.g. "AI chats"). */
  seriesLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis
          dataKey="weekStart"
          ticks={monthTicks(data)}
          tickFormatter={monthLabel}
          tickLine={false}
          axisLine={false}
          tick={{ fill: TICK_COLOR, fontSize: 11 }}
        />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tick={{ fill: TICK_COLOR, fontSize: 11 }}
        />
        <Tooltip
          labelFormatter={(value) => weekLabel(String(value))}
          formatter={(value) => [value, seriesLabel]}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            color: "var(--popover-foreground)",
            fontSize: 12,
          }}
        />
        <Line
          type="monotone"
          dataKey="count"
          stroke={LINE_COLOR}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
