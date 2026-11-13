/**
 * Weekly AI chats line chart for the admin dashboard. Kept in its own module so
 * the dashboard can lazy-load it: recharts is large and nothing else on the
 * page needs it (#1223).
 *
 * Colours are theme tokens, so the chart follows the light/dark switch like the
 * `@eduai/ui` donuts do.
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
import type { AdminWeeklyChats } from "~/types/admin-dashboard";

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
function monthTicks(data: AdminWeeklyChats[]): string[] {
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

export default function AdminUsageChart({ data }: { data: AdminWeeklyChats[] }) {
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
          formatter={(value) => [value, "AI chats"]}
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
