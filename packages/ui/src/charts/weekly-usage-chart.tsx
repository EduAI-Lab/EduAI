/**
 * Weekly usage line chart for the admin dashboards (Core's AI chats, AI
 * Tutor's tutoring sessions, Question Maker's question versions split into AI
 * and hand-written lines). A subpath export (`@eduai/ui/weekly-usage-chart`)
 * so each app can lazy-load it: recharts is large and nothing else on the page
 * needs it (#1223).
 *
 * Colours are theme tokens, so the chart follows the light/dark switch like the
 * donuts do.
 */
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** One week's count; `weekStart` is the Monday, as YYYY-MM-DD (UTC). */
export type WeeklyUsagePoint = { weekStart: string; count: number };

/** One week with several counts, one per line, keyed by each series' `key`. */
export type WeeklyMultiSeriesPoint = { weekStart: string } & Record<string, string | number>;

/** One line of a multi-series chart. */
export type WeeklyUsageSeries = {
  /** The point field this line plots. */
  key: string;
  /** Legend and tooltip name (e.g. "AI-generated"). */
  label: string;
  /** Any CSS colour; defaults to the primary colour, then the series palette. */
  color?: string;
};

export type WeeklyUsageChartProps =
  | {
      data: WeeklyUsagePoint[];
      /** What a point counts, for the tooltip (e.g. "AI chats"). */
      seriesLabel: string;
      series?: never;
    }
  | {
      data: WeeklyMultiSeriesPoint[];
      /** One line each, with a legend when there is more than one. */
      series: WeeklyUsageSeries[];
      seriesLabel?: never;
    };

const LINE_COLOR = "var(--primary)";
const GRID_COLOR = "var(--border)";
const TICK_COLOR = "var(--muted-foreground)";
/** Colours for the second and later lines when a series names none. */
const SERIES_COLORS = ["var(--color-series-2)", "var(--color-series-5)", "var(--color-series-1)"];

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
function monthTicks(data: { weekStart: string }[]): string[] {
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

/** The lines to draw: the given series with colours filled in, or the single `count` line. */
export function resolveSeries(props: WeeklyUsageChartProps): Required<WeeklyUsageSeries>[] {
  if (!props.series) return [{ key: "count", label: props.seriesLabel, color: LINE_COLOR }];
  return props.series.map((line, index) => ({
    ...line,
    color:
      line.color ?? (index === 0 ? LINE_COLOR : SERIES_COLORS[(index - 1) % SERIES_COLORS.length]),
  }));
}

export default function WeeklyUsageChart(props: WeeklyUsageChartProps) {
  const { data } = props;
  const lines = resolveSeries(props);
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
          formatter={(value, name) => [value, name]}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            color: "var(--popover-foreground)",
            fontSize: 12,
          }}
        />
        {lines.length > 1 && (
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: TICK_COLOR }} />
        )}
        {lines.map((line) => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            name={line.label}
            stroke={line.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
