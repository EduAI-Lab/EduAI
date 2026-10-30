import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { IconChevronDown, IconChevronRight, IconClock } from "@tabler/icons-react";
import { z } from "zod";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelpHint,
  Input,
  Label,
  Switch,
} from "@eduai/ui";

import { CORE_HELP } from "~/components/help/help-hints";

interface CourseStudentVisibilitySettingsProps {
  courseId: string;
  /** Refreshes the page's other copies of topics and files after a change. */
  onSaved?: () => Promise<void> | void;
}

/** GET /api/courses/:id/student-visibility: each file with its approved topics. */
const StudentVisibilityStateSchema = z.object({
  studentFilesVisible: z.boolean(),
  topics: z.array(z.object({ id: z.string(), name: z.string(), visibleToStudents: z.boolean() })),
  files: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      visibleToStudents: z.boolean(),
      availableAt: z.string().nullable(),
      topicIds: z.array(z.string()),
      hiddenByCanvas: z.boolean(),
    }),
  ),
});

type StudentVisibilityState = z.infer<typeof StudentVisibilityStateSchema>;
type VisibilityTopic = StudentVisibilityState["topics"][number];
type VisibilityFile = StudentVisibilityState["files"][number];

type VisibilityChange = { id: string; visibleToStudents: boolean };

/** The PATCH body: only what this change touches. */
type StudentVisibilityChanges = {
  studentFilesVisible?: boolean;
  topics?: VisibilityChange[];
  materials?: VisibilityChange[];
  fileGroup?:
    | { scope: "all" | "unfiled"; visibleToStudents: boolean }
    | { scope: "topic"; topicId: string; visibleToStudents: boolean };
};

/** A change that asks first, and what the dialog says about it. */
type PendingConfirm = {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
  changes: StudentVisibilityChanges;
};

/** Where the course stands, counted the way students meet it. */
export interface FileVisibilityCounts {
  total: number;
  shown: number;
  hiddenByCanvas: number;
  scheduled: number;
  hiddenTopics: number;
}

type CheckState = boolean | "indeterminate";

/** Ticked when every item is shown, empty when none is, a dash in between. */
function checkState(shown: boolean[]): CheckState {
  if (shown.every(Boolean)) return true;
  if (!shown.some(Boolean)) return false;
  return "indeterminate";
}

function files(count: number) {
  return count === 1 ? "1 file" : `${count} files`;
}

function isScheduled(file: VisibilityFile, now: number) {
  return file.availableAt !== null && new Date(file.availableAt).getTime() > now;
}

/** The sentence under "Show course materials to students". */
export function describeFileVisibility({
  total,
  shown,
  hiddenByCanvas,
  scheduled,
  hiddenTopics,
}: FileVisibilityCounts) {
  const parts = [
    total === 0
      ? "No files yet."
      : shown === total
        ? total === 1
          ? "Your 1 file is shown to students."
          : `All ${total} files are shown to students.`
        : shown === 0
          ? total === 1
            ? "Your 1 file is hidden from students."
            : `All ${total} files are hidden from students.`
          : `${shown} of ${total} files are shown to students, and ${total - shown} ${total - shown === 1 ? "is" : "are"} hidden.`,
  ];
  if (hiddenByCanvas > 0) {
    parts.push(
      hiddenByCanvas === 1
        ? "1 file is hidden in Canvas."
        : `${hiddenByCanvas} files are hidden in Canvas.`,
    );
  }
  if (scheduled > 0) {
    parts.push(
      scheduled === 1
        ? "1 shown file waits for its scheduled date."
        : `${scheduled} shown files wait for their scheduled date.`,
    );
  }
  if (hiddenTopics > 0) {
    parts.push(hiddenTopics === 1 ? "1 topic is hidden." : `${hiddenTopics} topics are hidden.`);
  }
  return parts.join(" ");
}

/**
 * What revealing means, for the dialog that asks first: the files students get,
 * the hidden topics shown with them, and what stays hidden.
 */
export function revealDescription(
  revealed: number,
  stillHidden: number,
  scheduled: boolean,
  topicsShown = 0,
) {
  const parts: string[] = [];
  if (revealed > 0) {
    parts.push(
      `${revealed === 1 ? "1 hidden file" : `${revealed} hidden files`} will be shown to students, and course chat will be able to use ${revealed === 1 ? "it to answer students. Make sure it should not stay private, like an answer key." : "them to answer students. Make sure none of them should stay private, such as answer keys."}`,
    );
  }
  if (topicsShown > 0) {
    const topics = topicsShown === 1 ? "1 hidden topic" : `${topicsShown} hidden topics`;
    parts.push(
      revealed > 0 ? `${topics} will be shown too.` : `${topics} will be shown to students.`,
    );
  } else if (revealed === 0) {
    parts.push("No file will be shown to students yet.");
  }
  if (stillHidden > 0) {
    parts.push(
      `${stillHidden === 1 ? "1 file stays" : `${stillHidden} files stay`} hidden, under another hidden topic or in Canvas.`,
    );
  }
  if (revealed > 0 && scheduled) {
    parts.push("Files scheduled for a later date still wait for that date.");
  }
  return parts.join(" ");
}

/** `datetime-local` works in the browser's zone; the API stores ISO (UTC). */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Key for the group of files filed under no approved topic. */
const NO_TOPIC = "no-topic";
/** Files listed per step in an open group, so a huge course stays responsive. */
const FILES_PER_STEP = 200;

/**
 * What enrolled students see in a course (#2002, #2061), and the one place it
 * changes: one switch for every file, which opens to each topic and then each
 * file, plus whether students may browse the files at all.
 *
 * Each change saves as it is made. Hiding a topic hides its files, including
 * ones filed under it later, and a hidden topic wins over a shown one. Showing
 * hidden files in bulk, and hiding everything, ask first: hiding cuts students
 * off, and showing reveals files someone may have hidden on purpose.
 */
export function CourseStudentVisibilitySettings({
  courseId,
  onSaved,
}: CourseStudentVisibilitySettingsProps) {
  const [state, setState] = useState<StudentVisibilityState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [byTopicOpen, setByTopicOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [listed, setListed] = useState<Record<string, number>>({});
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [scheduling, setScheduling] = useState<VisibilityFile | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/courses/${courseId}/student-visibility`);
    if (!res.ok) throw new Error(`Loading failed (${res.status})`);
    setState(StudentVisibilityStateSchema.parse(await res.json()));
  }, [courseId]);

  useEffect(() => {
    setState(null);
    setLoadError(false);
    load().catch(() => setLoadError(true));
  }, [load]);

  /**
   * Runs one change, then re-reads the course so every row shows what was
   * stored. A refused change re-reads too, so a file deleted meanwhile drops out.
   */
  const save = async (write: () => Promise<Response>) => {
    setSaving(true);
    setFeedback(null);
    try {
      let res: Response;
      try {
        res = await write();
      } catch {
        setFeedback({ error: true, text: "Could not save. Check your connection and try again." });
        return false;
      }
      if (!res.ok) {
        await load().catch(() => {});
        setFeedback({
          error: true,
          text: "Could not save. The list now shows the current settings; try again.",
        });
        return false;
      }
      try {
        await load();
        await onSaved?.();
        setFeedback({ error: false, text: "Saved." });
      } catch {
        setFeedback({
          error: true,
          text: "Saved, but the list could not refresh. Refresh the page to see it.",
        });
      }
      return true;
    } finally {
      setSaving(false);
    }
  };

  const change = (changes: StudentVisibilityChanges) =>
    save(() =>
      fetch(`/api/courses/${courseId}/student-visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      }),
    );

  const saveSchedule = async () => {
    if (!scheduling) return;
    let availableAt: string | null = null;
    if (scheduleDate) {
      const parsed = new Date(scheduleDate);
      if (Number.isNaN(parsed.getTime())) {
        setScheduleError("Enter a valid date and time.");
        return;
      }
      availableAt = parsed.toISOString();
    }
    setScheduleError(null);
    const saved = await save(() =>
      fetch(`/api/courses/${courseId}/materials/${scheduling.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availableAt }),
      }),
    );
    if (saved) setScheduling(null);
    else setScheduleError("Could not save the date. Try again.");
  };

  const toggleGroup = (key: string) =>
    setOpenGroups((open) => (open.includes(key) ? open.filter((k) => k !== key) : [...open, key]));

  if (!state) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>What students see</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p role="alert" className="text-sm text-destructive">
              Could not load what students see. Refresh the page to try again.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </CardContent>
      </Card>
    );
  }

  const now = Date.now();
  const hiddenTopicNames = new Map(
    state.topics.filter((t) => !t.visibleToStudents).map((t) => [t.id, t.name]),
  );
  const filesByTopic = new Map<string, VisibilityFile[]>();
  const unfiled: VisibilityFile[] = [];
  for (const file of state.files) {
    if (file.topicIds.length === 0) unfiled.push(file);
    for (const topicId of file.topicIds) {
      const group = filesByTopic.get(topicId);
      if (group) group.push(file);
      else filesByTopic.set(topicId, [file]);
    }
  }
  /** The hidden topic that hides this file, other than `except`, if any. */
  const hidingTopic = (file: VisibilityFile, except?: string) =>
    file.topicIds.find((id) => id !== except && hiddenTopicNames.has(id));
  const isShown = (file: VisibilityFile) =>
    file.visibleToStudents && !file.hiddenByCanvas && hidingTopic(file) === undefined;
  const isFuture = (file: VisibilityFile) => isScheduled(file, now);

  const counts: FileVisibilityCounts = {
    total: state.files.length,
    shown: state.files.filter(isShown).length,
    hiddenByCanvas: state.files.filter((f) => f.hiddenByCanvas).length,
    scheduled: state.files.filter((f) => isShown(f) && isFuture(f)).length,
    hiddenTopics: hiddenTopicNames.size,
  };
  const allShown = checkState([
    ...state.files.map((f) => f.visibleToStudents),
    ...state.topics.map((t) => t.visibleToStudents),
  ]);

  /**
   * Asks before revealing a group's hidden files, saying how many students will
   * get and which hidden topics are shown with them. Showing everything also shows
   * every topic; one topic's or the No topic group's files stay hidden where
   * another hidden topic or Canvas hides them. Showing one hidden topic
   * (`changes.topics`) reveals its files whose own switch is on, and goes
   * straight through when there are none.
   */
  const confirmReveal = (
    title: string,
    group: VisibilityFile[],
    changes: StudentVisibilityChanges,
    except?: string,
  ) => {
    const showsAll = changes.fileGroup?.scope === "all";
    const showsTopic = changes.topics !== undefined;
    const hidden = group.filter((f) => !isShown(f) && (!showsTopic || f.visibleToStudents));
    const revealed = hidden.filter(
      (f) => !f.hiddenByCanvas && (showsAll || hidingTopic(f, except) === undefined),
    );
    if (showsTopic && revealed.length === 0) {
      void change(changes);
      return;
    }
    setConfirm({
      title,
      description: revealDescription(
        revealed.length,
        hidden.length - revealed.length,
        revealed.some(isFuture),
        showsAll ? hiddenTopicNames.size : showsTopic ? 1 : 0,
      ),
      confirmLabel: "Show files",
      destructive: false,
      changes,
    });
  };

  const onAllChange = () => {
    if (allShown === true) {
      setConfirm({
        title: "Hide all materials from students?",
        description: `Students won't see any of this course's ${
          state.files.length > 0 ? files(state.files.length) : "topics"
        }, and course chat won't use them to answer students. Instructors and TAs still see every file. You can show them again at any time.`,
        confirmLabel: "Hide all materials",
        destructive: true,
        changes: { fileGroup: { scope: "all", visibleToStudents: false } },
      });
    } else {
      confirmReveal("Show all materials to students?", state.files, {
        fileGroup: { scope: "all", visibleToStudents: true },
      });
    }
  };

  const groupRow = (
    key: string,
    label: string,
    group: VisibilityFile[],
    topic: VisibilityTopic | null,
  ) => {
    const checked =
      topic && !topic.visibleToStudents
        ? false
        : checkState([...(topic ? [true] : []), ...group.map((f) => f.visibleToStudents)]);
    const onGroupChange = () => {
      if (topic && checked === false) {
        // Showing a hidden topic brings back the files not hidden some other way.
        confirmReveal(
          `Show “${label}” to students?`,
          group,
          { topics: [{ id: topic.id, visibleToStudents: true }] },
          topic.id,
        );
      } else if (topic && checked === true) {
        void change({ topics: [{ id: topic.id, visibleToStudents: false }] });
      } else if (checked === true) {
        void change({ fileGroup: { scope: "unfiled", visibleToStudents: false } });
      } else {
        const fileGroup = topic
          ? { scope: "topic" as const, topicId: topic.id, visibleToStudents: true }
          : { scope: "unfiled" as const, visibleToStudents: true };
        confirmReveal(`Show the hidden files in “${label}”?`, group, { fileGroup }, topic?.id);
      }
    };
    const hidden = group.filter((f) => !isShown(f)).length;
    const open = openGroups.includes(key);
    const limit = listed[key] ?? FILES_PER_STEP;
    const id = `student-group-${key}`;
    return (
      <li key={key} className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Checkbox id={id} checked={checked} disabled={saving} onCheckedChange={onGroupChange} />
          <Label htmlFor={id} className="font-normal">
            {label}
          </Label>
          <span className="text-xs text-muted-foreground">
            {group.length === 0
              ? "No files yet"
              : hidden === 0
                ? files(group.length)
                : `${files(group.length)}, ${hidden === group.length ? "all" : hidden} hidden`}
          </span>
          {group.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2 text-xs"
              aria-expanded={open}
              aria-label={`${open ? "Hide" : "Show"} the files in ${label}`}
              onClick={() => toggleGroup(key)}
            >
              {open ? (
                <IconChevronDown className="h-4 w-4" />
              ) : (
                <IconChevronRight className="h-4 w-4" />
              )}
              Files
            </Button>
          )}
        </div>
        {open && (
          <ul className="ml-6 flex flex-col gap-1 border-l pl-3">
            {group.slice(0, limit).map((file) => {
              const fileId = `student-file-${key}-${file.id}`;
              const blockedBy = hidingTopic(file);
              const note = file.hiddenByCanvas
                ? "Hidden in Canvas"
                : blockedBy
                  ? `Hidden with “${hiddenTopicNames.get(blockedBy)}”`
                  : null;
              return (
                <li key={file.id} className="flex items-center gap-2">
                  <Checkbox
                    id={fileId}
                    checked={file.visibleToStudents && note === null}
                    disabled={saving || note !== null}
                    onCheckedChange={() =>
                      void change({
                        materials: [{ id: file.id, visibleToStudents: !file.visibleToStudents }],
                      })
                    }
                  />
                  <Label htmlFor={fileId} className="min-w-0 truncate font-normal">
                    {file.title}
                  </Label>
                  {note && <span className="shrink-0 text-xs text-muted-foreground">{note}</span>}
                  {isFuture(file) && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <IconClock className="h-3 w-3" />
                      From{" "}
                      {new Date(file.availableAt ?? "").toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 shrink-0 px-2 text-xs"
                    aria-label={`Schedule ${file.title}`}
                    disabled={saving}
                    onClick={() => {
                      setScheduling(file);
                      setScheduleDate(isoToLocalInput(file.availableAt));
                      setScheduleError(null);
                    }}
                  >
                    Schedule
                  </Button>
                </li>
              );
            })}
            {group.length > limit && (
              <li>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setListed((all) => ({ ...all, [key]: limit + FILES_PER_STEP }))}
                >
                  Show more ({group.length - limit} not listed)
                </Button>
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  const browseId = `student-files-${courseId}`;
  const allId = `student-all-${courseId}`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>What students see</CardTitle>
          <HelpHint {...CORE_HELP.materialVisibility} LinkComponent={Link} />
        </div>
        <CardDescription>
          Choose which course files students can see. A hidden file is not shown to students, and
          course chat won&apos;t use it to answer them. Instructors and TAs always see every file.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex max-w-2xl flex-col gap-3 rounded-lg border p-4">
          {state.files.length === 0 && state.topics.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No files yet. Upload them on the Materials tab.
            </p>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <Checkbox
                  id={allId}
                  className="mt-0.5"
                  checked={allShown}
                  disabled={saving}
                  onCheckedChange={onAllChange}
                />
                <div className="flex flex-col gap-1">
                  <Label htmlFor={allId}>Show course materials to students</Label>
                  <p className="text-xs text-muted-foreground">{describeFileVisibility(counts)}</p>
                </div>
              </div>
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  aria-expanded={byTopicOpen}
                  onClick={() => setByTopicOpen((open) => !open)}
                >
                  {byTopicOpen ? (
                    <IconChevronDown className="h-4 w-4" />
                  ) : (
                    <IconChevronRight className="h-4 w-4" />
                  )}
                  Choose by topic
                </Button>
                {byTopicOpen && (
                  <div className="mt-2 flex flex-col gap-2">
                    <p className="text-xs text-muted-foreground">
                      Hiding a topic hides its name and its files, including files added to it
                      later. A file under a hidden topic stays hidden even if its other topic is
                      shown.
                    </p>
                    <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded-md border p-3">
                      {state.topics.map((topic) =>
                        groupRow(topic.id, topic.name, filesByTopic.get(topic.id) ?? [], topic),
                      )}
                      {unfiled.length > 0 && groupRow(NO_TOPIC, "No topic", unfiled, null)}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex max-w-2xl items-center justify-between gap-3 rounded-lg border p-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor={browseId}>Let students browse files</Label>
            <p className="text-xs text-muted-foreground">
              Off by default. When on, students can list and preview the shown files on the course
              page. Course chat uses the shown files either way and never names a file to a student.
            </p>
          </div>
          <Switch
            id={browseId}
            checked={state.studentFilesVisible}
            disabled={saving}
            onCheckedChange={(studentFilesVisible) => void change({ studentFilesVisible })}
          />
        </div>

        <p
          role={feedback?.error ? "alert" : "status"}
          className={feedback?.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
        >
          {saving ? "Saving…" : feedback?.text}
        </p>
      </CardContent>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm?.title ?? ""}
        description={confirm?.description ?? ""}
        confirmLabel={confirm?.confirmLabel}
        variant={confirm?.destructive ? "destructive" : "default"}
        onConfirm={() => {
          if (confirm) void change(confirm.changes);
        }}
      />

      <Dialog
        open={scheduling !== null}
        onOpenChange={(open) => {
          if (!open) setScheduling(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>When students can see this file</DialogTitle>
            <DialogDescription>
              Students see “{scheduling?.title}” from the date and time you choose. Leave it empty
              to show it right away. A hidden file stays hidden until you show it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="student-file-available-at">Show from</Label>
            <div className="flex items-center gap-2">
              <Input
                id="student-file-available-at"
                type="datetime-local"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
              />
              {scheduleDate && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setScheduleDate("")}>
                  Clear
                </Button>
              )}
            </div>
            {scheduleError && (
              <p role="alert" className="text-sm text-destructive">
                {scheduleError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduling(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void saveSchedule()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
