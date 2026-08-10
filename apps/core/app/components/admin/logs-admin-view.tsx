import { useMemo, useRef, useState } from "react";
import { Form, Link, useNavigation } from "react-router";

import { LogDetailsDialog } from "~/components/admin/log-details-dialog";
import { Badge, PageHeading, Spinner } from "@eduai/ui";
import { Button } from "@eduai/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@eduai/ui";
import { Input } from "@eduai/ui";
import { Label } from "@eduai/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@eduai/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@eduai/ui";
import { Tabs, TabsList, TabsTrigger } from "@eduai/ui";

export type LogsTab = "audit" | "security" | "system" | "servers";

type LogsQueryState = Record<string, string | undefined>;

type LogRetentionPolicy = {
  auditRetentionDays: number;
  systemRetentionDays: number;
};

export type ServerRoutingStat = {
  serverId: string | null;
  count: number;
  /** Distinct chats served, not distinct turns — always <= count. */
  distinctChatCount: number;
  totalTokens: number;
  totalDurationMs: number;
  totalCostUsd: number;
  totalEnergyJoules: number;
  totalCarbonGramsCO2: number;
  /** Live from the server's /v1/models endpoint; null if unreachable or unregistered. */
  models: string[] | null;
};

export type ModelRoutingStat = {
  modelUsed: string;
  count: number;
  totalTokens: number;
  totalDurationMs: number;
  totalCostUsd: number;
  totalEnergyJoules: number;
  totalCarbonGramsCO2: number;
};

export type HourlyUsageStat = {
  /** UTC hour-of-day, 0-23. */
  hour: number;
  count: number;
};

type LogsAdminViewProps = {
  tab: LogsTab;
  rows: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  query: LogsQueryState;
  retentionPolicy: LogRetentionPolicy;
  serverStats?: ServerRoutingStat[];
  modelStats?: ModelRoutingStat[];
  peakUsageHours?: HourlyUsageStat[];
};

// Audit categories exclude SECURITY — security events have their own hard-scoped tab.
const AUDIT_CATEGORIES = [
  "USER",
  "INVITATION",
  "COURSE",
  "ENROLLMENT",
  "MATERIAL",
  "TOPIC",
  "AI_CONFIG",
  "CANVAS",
  "BUG_REPORT",
] as const;

const OUTCOMES = ["SUCCESS", "FAILURE", "DENIED"] as const;
const SYSTEM_LEVELS = ["ERROR", "WARN", "INFO"] as const;
const SYSTEM_SOURCES = [
  "ROUTE",
  "AUTH",
  "AI",
  "CANVAS",
  "MAIL",
  "DB",
  "SSR",
  "API",
] as const;

// Keys whose empty string is a meaningful value ("All time" for datePreset),
// not "absent" — buildQueryString must be able to preserve/set "" for these
// instead of treating an empty string as "delete this key" like every other
// filter. Without this, "All time" silently reverts to the default on the
// very next link built from the resulting query state (tab switch,
// pagination, a reload of the bookmarked URL).
const PRESERVE_EMPTY_STRING_KEYS = new Set(["datePreset"]);

/**
 * Builds a query string while preserving existing URL-driven state.
 */
function buildQueryString(
  current: LogsQueryState,
  overrides: Record<string, string | number | undefined | null>,
) {
  const params = new URLSearchParams();

  // Preserving existing values keeps tab/filter transitions bookmarkable.
  for (const [key, value] of Object.entries(current)) {
    if (typeof value !== "string") continue;
    if (value.trim() || (value === "" && PRESERVE_EMPTY_STRING_KEYS.has(key))) {
      params.set(key, value.trim());
    }
  }

  // Overrides can either set a new value, explicitly set "" for a key that
  // treats "" as meaningful, or clear a key completely (undefined/null, or
  // "" for every other key).
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) {
      params.delete(key);
      continue;
    }
    const stringValue = String(value).trim();
    if (stringValue === "" && !PRESERVE_EMPTY_STRING_KEYS.has(key)) {
      params.delete(key);
    } else {
      params.set(key, stringValue);
    }
  }

  const next = params.toString();
  return next ? `?${next}` : "?";
}

/**
 * Switching away from Servers must discard the whole rolling-date state. The
 * loader materializes a preset into dateFrom/dateTo for display, so dropping
 * only datePreset would turn a rolling window into a frozen custom range when
 * the admin returns to Servers.
 */
export function buildLogsTabLinks(query: LogsQueryState) {
  const leaveServers = { page: 1, datePreset: undefined, dateFrom: undefined, dateTo: undefined };
  return {
    audit: buildQueryString(query, { tab: "audit", ...leaveServers }),
    security: buildQueryString(query, { tab: "security", ...leaveServers }),
    system: buildQueryString(query, { tab: "system", ...leaveServers }),
    servers: buildQueryString(query, { tab: "servers", page: 1 }),
  };
}

/**
 * Formats timestamps consistently across all log tabs.
 */
function formatTimestamp(value: unknown) {
  if (typeof value !== "string") {
    return "-";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/**
 * Keeps row-key lookup stable while allowing mixed log row shapes.
 */
function getRowValue(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

/**
 * Combines live user-join data with stored actorRole so actor attribution remains readable over time.
 */
function formatActorDisplay(row: Record<string, unknown>) {
  const user = row.user;
  const userRecord =
    typeof user === "object" && user !== null
      ? (user as Record<string, unknown>)
      : null;

  const actorNameRaw = userRecord?.name;
  const actorRoleRaw = row.actorRole ?? userRecord?.role;

  const actorName =
    typeof actorNameRaw === "string" && actorNameRaw.trim()
      ? actorNameRaw.trim()
      : null;
  const actorRole =
    typeof actorRoleRaw === "string" && actorRoleRaw.trim()
      ? actorRoleRaw.trim()
      : null;

  if (actorName && actorRole) {
    return `${actorName} (${actorRole})`;
  }
  if (actorName) {
    return actorName;
  }
  if (actorRole) {
    return actorRole;
  }
  return "Unknown";
}

/**
 * Removes only tab-specific filters while preserving shared pagination/sort controls.
 */
function buildClearFiltersHref(tab: LogsTab, query: LogsQueryState) {
  if (tab === "audit") {
    return buildQueryString(query, {
      page: 1,
      category: undefined,
      actionCode: undefined,
      actorRole: undefined,
      entityType: undefined,
      outcome: undefined,
      routePath: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      // Belt-and-suspenders: a bookmarked/shared URL from before this was
      // fixed could still carry a stray Servers-tab datePreset.
      datePreset: undefined,
    });
  }

  if (tab === "security") {
    return buildQueryString(query, {
      page: 1,
      actionCode: undefined,
      actorRole: undefined,
      outcome: undefined,
      routePath: undefined,
      ipAddress: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      datePreset: undefined,
    });
  }

  return buildQueryString(query, {
    page: 1,
    level: undefined,
    source: undefined,
    code: undefined,
    dateFrom: undefined,
    dateTo: undefined,
    datePreset: undefined,
  });
}

// Sentinel for the "All" / empty option — Radix Select disallows an empty-string
// item value, so we map "" <-> this sentinel and submit "" through the hidden input.
const ALL_VALUE = "__all";

/**
 * Design-system Select wired into the surrounding GET <Form>: a hidden input
 * carries the chosen value so filters still submit via the URL on "Apply",
 * while the visible control matches every other dropdown on the platform.
 */
function FilterSelect({
  name,
  defaultValue,
  placeholder,
  options,
}: {
  name: string;
  defaultValue: string;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Select
        value={value === "" ? ALL_VALUE : value}
        onValueChange={(v) => setValue(v === ALL_VALUE ? "" : v)}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value === "" ? ALL_VALUE : o.value} value={o.value === "" ? ALL_VALUE : o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function outcomeVariant(
  outcome: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (outcome === "DENIED" || outcome === "FAILURE") return "destructive";
  if (outcome === "SUCCESS") return "secondary";
  return "outline";
}

function levelVariant(
  level: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (level === "ERROR") return "destructive";
  if (level === "WARN") return "default";
  return "secondary";
}

function formatCount(value: number) {
  return value.toLocaleString();
}

function formatCostUsd(value: number) {
  return `$${value.toFixed(4)}`;
}

function formatDurationMs(totalDurationMs: number, count: number) {
  if (count === 0) return "-";
  return `${Math.round(totalDurationMs / count).toLocaleString()} ms avg`;
}

function formatEnergy(joules: number) {
  if (joules <= 0) return "-";
  return `${(joules / 1000).toFixed(2)} kJ`;
}

function formatCarbon(grams: number) {
  if (grams <= 0) return "-";
  return `${grams.toFixed(2)} g CO₂`;
}

/** Zero-padded UTC hour label, e.g. 0 -> "00", 13 -> "13". */
function formatHourLabel(hour: number): string {
  return String(hour).padStart(2, "0");
}

/**
 * Simple 24-bar histogram for the peak-usage-hours card — plain CSS bars
 * rather than pulling in a charting library for one chart. Bar height is
 * relative to the busiest hour in the window; every hour renders (even at
 * zero) so gaps in traffic are visible rather than silently omitted.
 */
function PeakUsageHoursChart({ hours }: { hours: HourlyUsageStat[] }) {
  const maxCount = Math.max(1, ...hours.map((h) => h.count));
  const totalCount = hours.reduce((sum, h) => sum + h.count, 0);

  if (totalCount === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        No interactions found for the selected window.
      </p>
    );
  }

  return (
    <div className="flex items-end gap-1 overflow-x-auto pb-2" role="img" aria-label="Interaction volume by hour of day, UTC">
      {hours.map((h) => (
        <div key={h.hour} className="flex min-w-[1.75rem] flex-1 flex-col items-center gap-1">
          <span className="text-muted-foreground text-[10px] tabular-nums">{formatCount(h.count)}</span>
          <div
            className="bg-primary/70 w-full rounded-t"
            style={{ height: `${Math.max(2, Math.round((h.count / maxCount) * 96))}px` }}
            title={`${formatHourLabel(h.hour)}:00 UTC — ${formatCount(h.count)} interaction${h.count === 1 ? "" : "s"}`}
          />
          <span className="text-muted-foreground text-[10px] tabular-nums">{formatHourLabel(h.hour)}</span>
        </div>
      ))}
    </div>
  );
}

// Preset windows for the Servers tab date filter. The value is the number of
// trailing days as a string, resolved to real dates server-side (see
// admin.logs.tsx loader) so "Last 30 days" always means the 30 days ending
// on submit, not a window frozen at whatever moment this file happened to
// compute it. "" is "All time" (no bound). Order matches dropdown order.
const DATE_RANGE_PRESETS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 3 months" },
  { value: "", label: "All time" },
] as const;

const CUSTOM_RANGE_VALUE = "custom";

/**
 * Resolves the dropdown's initial selection from the loader's query state.
 * `query.datePreset` is authoritative when present (including "" for an
 * explicit "All time"); its absence with explicit dateFrom/dateTo means the
 * admin used the custom-range inputs.
 */
function matchPresetValue(
  datePreset: string | undefined,
  dateFrom: string | undefined,
  dateTo: string | undefined,
): string {
  if (datePreset !== undefined) {
    return DATE_RANGE_PRESETS.some((p) => p.value === datePreset) ? datePreset : CUSTOM_RANGE_VALUE;
  }
  if (!dateFrom && !dateTo) return "";
  return CUSTOM_RANGE_VALUE;
}

/**
 * Routing/model breakdown for the Servers tab (#1351). Distinct from the
 * paginated row tables above — these are date-range aggregates, so the panel
 * renders its own date filter and two summary tables rather than reusing the
 * shared results table.
 */
function ServerRoutingPanel({
  query,
  serverStats,
  modelStats,
  peakUsageHours,
  isLoading,
}: {
  query: LogsQueryState;
  serverStats: ServerRoutingStat[];
  modelStats: ModelRoutingStat[];
  peakUsageHours: HourlyUsageStat[];
  // Lifted from LogsAdminView (rather than read via useNavigation() here) so
  // the same pending state also covers the navigation that mounts this panel
  // in the first place — see the comment at the LogsAdminView call site.
  isLoading: boolean;
}) {
  const totalInteractions = serverStats.reduce((sum, row) => sum + row.count, 0);

  const initialPreset = matchPresetValue(query.datePreset, query.dateFrom, query.dateTo);
  const [presetValue, setPresetValue] = useState(initialPreset);
  const isCustom = presetValue === CUSTOM_RANGE_VALUE;
  const filterFormRef = useRef<HTMLFormElement>(null);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="pt-6">
          <Form method="get" ref={filterFormRef}>
            <input type="hidden" name="tab" value="servers" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="grid gap-1.5">
                <Label className="text-xs">Date range</Label>
                <Select
                  // Radix Select treats an empty string as "no selection", so an
                  // empty presetValue (the "All time" preset's value) would show
                  // the "Date range" placeholder instead of the "All time" label.
                  // Map "" <-> ALL_VALUE the same way FilterSelect does above.
                  value={presetValue === "" ? ALL_VALUE : presetValue}
                  onValueChange={(value) => {
                    const resolved = value === ALL_VALUE ? "" : value;
                    setPresetValue(resolved);
                    // Presets are a complete, valid filter on their own — submit
                    // right away rather than making the admin also hit Apply.
                    // Custom needs the date inputs filled in first, so it waits
                    // for the explicit Apply click below.
                    if (resolved !== CUSTOM_RANGE_VALUE) {
                      requestAnimationFrame(() => filterFormRef.current?.requestSubmit());
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Date range" />
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_RANGE_PRESETS.map((preset) => (
                      <SelectItem
                        key={preset.value || "all"}
                        value={preset.value === "" ? ALL_VALUE : preset.value}
                      >
                        {preset.label}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_RANGE_VALUE}>Custom range…</SelectItem>
                  </SelectContent>
                </Select>
                {!isCustom && (
                  // Presets compute dateFrom/dateTo as of submit time via
                  // hidden inputs carrying the resolved preset id — the
                  // server (admin.logs.tsx) recognizes numeric-day values
                  // and resolves them to real dates, so "Last 30 days"
                  // means the 30 days ending on load/submit, not a frozen
                  // window from when this page happened to render.
                  <input type="hidden" name="datePreset" value={presetValue} />
                )}
              </div>
              {isCustom && (
                <>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Date from</Label>
                    <Input type="date" name="dateFrom" defaultValue={query.dateFrom ?? ""} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Date to</Label>
                    <Input type="date" name="dateTo" defaultValue={query.dateTo ?? ""} />
                  </div>
                </>
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={isLoading}>
                {isLoading ? <Spinner size="sm" className="mr-1.5" /> : null}
                Apply filters
              </Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <Link
                  to={buildQueryString(query, {
                    tab: "servers",
                    dateFrom: undefined,
                    dateTo: undefined,
                    datePreset: "",
                  })}
                  onClick={() => setPresetValue("")}
                >
                  Clear filters
                </Link>
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Routing by server</CardTitle>
          <CardDescription>
            How much traffic each registered fleet server (CMPS01/02/03, and any server added
            later) has answered in the selected window, and which models it currently hosts
            (live, refreshed every 30s). Servers with no traffic yet still show up here once
            they're registered — no need to wait for their first interaction. "Chats" counts
            distinct conversations, not turns — interactions with no owning chat (e.g. async
            Question Maker jobs) aren't counted here since there's no chat to attribute them to.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Spinner size="md" />
            </div>
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Server</TableHead>
                <TableHead>Models hosted</TableHead>
                <TableHead className="text-right">Interactions</TableHead>
                <TableHead className="text-right">Chats</TableHead>
                <TableHead className="text-right">Share</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Avg duration</TableHead>
                <TableHead className="text-right">Est. cost</TableHead>
                <TableHead className="text-right">Energy</TableHead>
                <TableHead className="text-right">Carbon</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {serverStats.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-muted-foreground py-8 text-center">
                    No fleet servers registered and no fleet-routed interactions found for the
                    selected window.
                  </TableCell>
                </TableRow>
              )}
              {serverStats.map((row) => (
                <TableRow key={row.serverId ?? "unknown"}>
                  <TableCell className="font-medium">
                    {row.serverId ?? (
                      <span className="text-muted-foreground">Not fleet-routed / unknown</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.models === null
                      ? "unreachable"
                      : row.models.length === 0
                        ? "none reported"
                        : row.models.join(", ")}
                  </TableCell>
                  <TableCell className="text-right">{formatCount(row.count)}</TableCell>
                  <TableCell className="text-right">{formatCount(row.distinctChatCount)}</TableCell>
                  <TableCell className="text-right">
                    {totalInteractions > 0 ? `${Math.round((row.count / totalInteractions) * 100)}%` : "-"}
                  </TableCell>
                  <TableCell className="text-right">{formatCount(row.totalTokens)}</TableCell>
                  <TableCell className="text-right">{formatDurationMs(row.totalDurationMs, row.count)}</TableCell>
                  <TableCell className="text-right">{formatCostUsd(row.totalCostUsd)}</TableCell>
                  <TableCell className="text-right">{formatEnergy(row.totalEnergyJoules)}</TableCell>
                  <TableCell className="text-right">{formatCarbon(row.totalCarbonGramsCO2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Answers by model</CardTitle>
          <CardDescription>
            How much of the traffic each AI model answered, regardless of which server hosted it.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Spinner size="md" />
            </div>
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Interactions</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Avg duration</TableHead>
                <TableHead className="text-right">Est. cost</TableHead>
                <TableHead className="text-right">Energy</TableHead>
                <TableHead className="text-right">Carbon</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {modelStats.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                    No interactions found for the selected window.
                  </TableCell>
                </TableRow>
              )}
              {modelStats.map((row) => (
                <TableRow key={row.modelUsed}>
                  <TableCell className="font-medium">{row.modelUsed}</TableCell>
                  <TableCell className="text-right">{formatCount(row.count)}</TableCell>
                  <TableCell className="text-right">{formatCount(row.totalTokens)}</TableCell>
                  <TableCell className="text-right">{formatDurationMs(row.totalDurationMs, row.count)}</TableCell>
                  <TableCell className="text-right">{formatCostUsd(row.totalCostUsd)}</TableCell>
                  <TableCell className="text-right">{formatEnergy(row.totalEnergyJoules)}</TableCell>
                  <TableCell className="text-right">{formatCarbon(row.totalCarbonGramsCO2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Peak usage hours</CardTitle>
          <CardDescription>
            Interaction volume by hour of day (UTC), across all servers and models, for the
            selected window — helps spot when the fleet is busiest for capacity planning.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Spinner size="md" />
            </div>
          ) : (
            <PeakUsageHoursChart hours={peakUsageHours} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Shared admin view for audit/security/system log browsing.
 *
 * Keeps filtering, pagination, and details UX consistent so admin users can
 * investigate incidents from a single predictable surface. All filter state is
 * URL-driven (GET <Form>), so every view is directly shareable/bookmarkable.
 */
export function LogsAdminView({
  tab,
  rows,
  total,
  page,
  pageSize,
  hasMore,
  query,
  retentionPolicy,
  serverStats,
  modelStats,
  peakUsageHours,
}: LogsAdminViewProps) {
  const [selectedRow, setSelectedRow] = useState<Record<
    string,
    unknown
  > | null>(null);

  // Hoisted above ServerRoutingPanel (rather than read inside it) so the
  // pending state also covers navigating *into* the Servers tab from
  // another tab: while that navigation is in flight, `tab` here is still
  // the previous tab's server-rendered value, so ServerRoutingPanel hasn't
  // mounted yet and any spinner living only inside it would never show.
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";
  const isNavigatingToServers =
    navigation.state !== "idle" &&
    new URLSearchParams(navigation.location?.search ?? "").get("tab") === "servers";

  const prevHref =
    page > 1 ? buildQueryString(query, { page: page - 1 }) : null;
  const nextHref = hasMore ? buildQueryString(query, { page: page + 1 }) : null;

  const tabLinks = useMemo(() => buildLogsTabLinks(query), [query]);

  const clearFiltersHref = buildClearFiltersHref(tab, query);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6">
          <div className="flex items-start justify-between gap-4">
            <PageHeading
              heading="Logs"
              subheading="Audit, security, and system diagnostics for operational investigations."
            />
          </div>

      {/* Tabs are links so each view remains directly shareable by URL. */}
      <Tabs value={tab}>
        <TabsList>
          <TabsTrigger value="audit" asChild>
            <Link to={tabLinks.audit}>Audit</Link>
          </TabsTrigger>
          <TabsTrigger value="security" asChild>
            <Link to={tabLinks.security}>Security</Link>
          </TabsTrigger>
          <TabsTrigger value="system" asChild>
            <Link to={tabLinks.system}>System</Link>
          </TabsTrigger>
          <TabsTrigger value="servers" asChild>
            <Link to={tabLinks.servers}>Servers</Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab !== "servers" && isNavigatingToServers ? (
        // Servers tab requested from another tab: the loader hasn't resolved
        // yet, so `tab` is still the outgoing tab and ServerRoutingPanel
        // hasn't mounted. Show a lightweight indicator here instead of
        // rendering the outgoing tab's (about-to-be-replaced) filter form.
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Spinner size="md" />
        </div>
      ) : tab === "servers" ? (
        <ServerRoutingPanel
          query={query}
          serverStats={serverStats ?? []}
          modelStats={modelStats ?? []}
          peakUsageHours={peakUsageHours ?? []}
          isLoading={isLoading}
        />
      ) : (
        <>
      {/* Filters — GET form so the URL stays the source of truth. */}
      <Card>
        <CardContent className="pt-6">
          <Form method="get">
            <input type="hidden" name="tab" value={tab} />
            {/* Filter submits always reset to page 1 so newly narrowed results start at a valid index. */}
            <input type="hidden" name="page" value="1" />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="grid gap-1.5">
                <Label className="text-xs">Page size</Label>
                <FilterSelect
                  name="pageSize"
                  defaultValue={query.pageSize ?? String(pageSize)}
                  placeholder="Page size"
                  options={[
                    { value: "25", label: "25" },
                    { value: "50", label: "50" },
                    { value: "100", label: "100" },
                  ]}
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs">Direction</Label>
                <FilterSelect
                  name="direction"
                  defaultValue={query.direction ?? "desc"}
                  placeholder="Direction"
                  options={[
                    { value: "desc", label: "Newest first" },
                    { value: "asc", label: "Oldest first" },
                  ]}
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs">Date from</Label>
                <Input
                  type="date"
                  name="dateFrom"
                  defaultValue={query.dateFrom ?? ""}
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs">Date to</Label>
                <Input
                  type="date"
                  name="dateTo"
                  defaultValue={query.dateTo ?? ""}
                />
              </div>

              {tab === "audit" && (
                <>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Category</Label>
                    <FilterSelect
                      name="category"
                      defaultValue={query.category ?? ""}
                      placeholder="Category"
                      options={[
                        { value: "", label: "All" },
                        ...AUDIT_CATEGORIES.map((category) => ({ value: category, label: category })),
                      ]}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Action code</Label>
                    <Input
                      name="actionCode"
                      defaultValue={query.actionCode ?? ""}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Actor role</Label>
                    <Input
                      name="actorRole"
                      defaultValue={query.actorRole ?? ""}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Entity type</Label>
                    <Input
                      name="entityType"
                      defaultValue={query.entityType ?? ""}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Outcome</Label>
                    <FilterSelect
                      name="outcome"
                      defaultValue={query.outcome ?? ""}
                      placeholder="Outcome"
                      options={[
                        { value: "", label: "All" },
                        ...OUTCOMES.map((outcome) => ({ value: outcome, label: outcome })),
                      ]}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Route path</Label>
                    <Input
                      name="routePath"
                      defaultValue={query.routePath ?? ""}
                    />
                  </div>
                </>
              )}

              {tab === "security" && (
                <>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Action code</Label>
                    <Input
                      name="actionCode"
                      defaultValue={query.actionCode ?? ""}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Outcome</Label>
                    <FilterSelect
                      name="outcome"
                      defaultValue={query.outcome ?? ""}
                      placeholder="Outcome"
                      options={[
                        { value: "", label: "All" },
                        ...OUTCOMES.map((outcome) => ({ value: outcome, label: outcome })),
                      ]}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Actor role</Label>
                    <Input
                      name="actorRole"
                      defaultValue={query.actorRole ?? ""}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Route path</Label>
                    <Input
                      name="routePath"
                      defaultValue={query.routePath ?? ""}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">IP address</Label>
                    <Input
                      name="ipAddress"
                      defaultValue={query.ipAddress ?? ""}
                    />
                  </div>
                </>
              )}

              {tab === "system" && (
                <>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Level</Label>
                    <FilterSelect
                      name="level"
                      defaultValue={query.level ?? ""}
                      placeholder="Level"
                      options={[
                        { value: "", label: "All" },
                        ...SYSTEM_LEVELS.map((level) => ({ value: level, label: level })),
                      ]}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Source</Label>
                    <FilterSelect
                      name="source"
                      defaultValue={query.source ?? ""}
                      placeholder="Source"
                      options={[
                        { value: "", label: "All" },
                        ...SYSTEM_SOURCES.map((source) => ({ value: source, label: source })),
                      ]}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Code</Label>
                    <Input name="code" defaultValue={query.code ?? ""} />
                  </div>
                </>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm">
                Apply filters
              </Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <Link to={clearFiltersHref}>Clear filters</Link>
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      {/* Retention policy + manual cleanup. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Retention</CardTitle>
          <CardDescription>
            Logs older than the configured window are removed on a daily sweep,
            or on demand below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Form method="post" className="flex flex-wrap items-end gap-3">
            <input
              type="hidden"
              name="intent"
              value="updateLogRetentionPolicy"
            />
            <div className="grid gap-1.5">
              <Label className="text-xs">Audit retention (days)</Label>
              <Input
                type="number"
                name="auditRetentionDays"
                min={1}
                max={3650}
                defaultValue={retentionPolicy.auditRetentionDays}
                className="w-40"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">System retention (days)</Label>
              <Input
                type="number"
                name="systemRetentionDays"
                min={1}
                max={3650}
                defaultValue={retentionPolicy.systemRetentionDays}
                className="w-40"
              />
            </div>
            <Button type="submit" size="sm">
              Save retention policy
            </Button>
          </Form>

          <div className="flex flex-wrap items-center gap-2">
            <Form method="post">
              <input type="hidden" name="intent" value="cleanupAuditLogsNow" />
              <Button type="submit" size="sm" variant="outline">
                Cleanup audit &gt; {retentionPolicy.auditRetentionDays} days
              </Button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="cleanupSystemLogsNow" />
              <Button type="submit" size="sm" variant="outline">
                Cleanup system &gt; {retentionPolicy.systemRetentionDays} days
              </Button>
            </Form>
          </div>
        </CardContent>
      </Card>

      {/* Results table. */}
      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <Table>
            <TableHeader>
              {tab === "audit" && (
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead className="text-right">Details</TableHead>
                </TableRow>
              )}
              {tab === "security" && (
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead className="text-right">Details</TableHead>
                </TableRow>
              )}
              {tab === "system" && (
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="text-right">Details</TableHead>
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={tab === "audit" ? 8 : tab === "security" ? 7 : 6}
                    className="text-muted-foreground py-8 text-center"
                  >
                    No logs found for the selected filters.
                  </TableCell>
                </TableRow>
              )}

              {rows.map((row) => (
                <TableRow key={getRowValue(row, "id")}>
                  <TableCell className="whitespace-nowrap">
                    {formatTimestamp(row.createdAt)}
                  </TableCell>

                  {tab === "audit" && (
                    <>
                      <TableCell className="font-medium">
                        {getRowValue(row, "actionCode")}
                      </TableCell>
                      <TableCell>{getRowValue(row, "category")}</TableCell>
                      <TableCell>{formatActorDisplay(row)}</TableCell>
                      <TableCell>{getRowValue(row, "entityLabel")}</TableCell>
                      <TableCell>
                        <Badge
                          variant={outcomeVariant(getRowValue(row, "outcome"))}
                        >
                          {getRowValue(row, "outcome")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {getRowValue(row, "routePath")}
                      </TableCell>
                    </>
                  )}

                  {tab === "security" && (
                    <>
                      <TableCell className="font-medium">
                        {getRowValue(row, "actionCode")}
                      </TableCell>
                      <TableCell>{formatActorDisplay(row)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={outcomeVariant(getRowValue(row, "outcome"))}
                        >
                          {getRowValue(row, "outcome")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {getRowValue(row, "routePath")}
                      </TableCell>
                      <TableCell>{getRowValue(row, "ipAddress")}</TableCell>
                    </>
                  )}

                  {tab === "system" && (
                    <>
                      <TableCell>
                        <Badge
                          variant={levelVariant(getRowValue(row, "level"))}
                        >
                          {getRowValue(row, "level")}
                        </Badge>
                      </TableCell>
                      <TableCell>{getRowValue(row, "source")}</TableCell>
                      <TableCell className="font-medium">
                        {getRowValue(row, "code")}
                      </TableCell>
                      <TableCell className="max-w-md truncate">
                        {getRowValue(row, "message")}
                      </TableCell>
                    </>
                  )}

                  <TableCell className="text-right">
                    {/* Explicit details interaction prevents overloading primary columns with verbose JSON. */}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedRow(row)}
                    >
                      View details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination. */}
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          Page {page} of {totalPages} ({rows.length} row
          {rows.length === 1 ? "" : "s"} shown, {total} total)
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!prevHref}
            asChild={!!prevHref}
          >
            {prevHref ? (
              <Link to={prevHref}>Previous</Link>
            ) : (
              <span>Previous</span>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!nextHref}
            asChild={!!nextHref}
          >
            {nextHref ? <Link to={nextHref}>Next</Link> : <span>Next</span>}
          </Button>
        </div>
      </div>

      <LogDetailsDialog
        title={`${tab.toUpperCase()} log details`}
        row={selectedRow}
        onClose={() => setSelectedRow(null)}
      />
        </>
      )}
        </div>
      </div>
    </div>
  );
}
