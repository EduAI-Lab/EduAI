import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Label,
  Switch,
} from "@eduai/ui";

import type { CourseTopic } from "~/hooks/api/use-course-topics";

interface CourseStudentVisibilitySettingsProps {
  courseId: string;
  studentFilesVisible: boolean;
  topics: CourseTopic[];
  /** Refetches the topics after a save, so the controls show what was stored. */
  onSaved?: () => Promise<void> | void;
}

/** The PATCH body: only the settings this manager changed. */
type StudentVisibilityChanges = {
  studentFilesVisible?: boolean;
  topics?: { id: string; visibleToStudents: boolean }[];
};

/** Whether students are shown this topic, as stored. */
function stored(topic: CourseTopic) {
  return topic.visibleToStudents !== false;
}

/**
 * What enrolled students see in a course (#2002). The card is one switch that
 * shows or hides every approved topic; File and topic settings opens the file setting and
 * the per-topic choices.
 *
 * A save sends only what this manager changed since the page loaded or they last
 * saved — never the whole list from what may be a stale page — so it cannot undo
 * a change another manager made to anything else in the meantime.
 */
export function CourseStudentVisibilitySettings({
  courseId,
  studentFilesVisible,
  topics,
  onSaved,
}: CourseStudentVisibilitySettingsProps) {
  // The file setting as loaded or last saved. The loader is not re-run on save.
  const [savedFiles, setSavedFiles] = useState(studentFilesVisible);
  const [files, setFiles] = useState(studentFilesVisible);
  // Topic choices this manager saved, kept until the topics show them as stored,
  // so a failed refetch cannot flip a saved topic back to its stale value.
  const [savedTopics, setSavedTopics] = useState<Record<string, boolean>>({});
  // Unsaved ticks in File and topic settings; closing it without saving drops them.
  const [topicEdits, setTopicEdits] = useState<Record<string, boolean>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    error: boolean;
    text: string;
  } | null>(null);

  useEffect(() => {
    setSavedTopics((saved) => {
      const pending = Object.entries(saved).filter(([id, value]) => {
        const topic = topics.find((t) => t.id === id);
        return topic !== undefined && stored(topic) !== value;
      });
      return pending.length === Object.keys(saved).length ? saved : Object.fromEntries(pending);
    });
  }, [topics]);

  // Only an approved topic can be shown to students; Uncategorized never is.
  const eligible = topics.filter(
    (topic) => topic.reviewStatus === "ACCEPTED" && topic.name !== "Uncategorized",
  );
  const current = (topic: CourseTopic) => savedTopics[topic.id] ?? stored(topic);
  const shown = (topic: CourseTopic) => topicEdits[topic.id] ?? current(topic);
  const changedTopics = eligible
    .filter((topic) => shown(topic) !== current(topic))
    .map((topic) => ({ id: topic.id, visibleToStudents: shown(topic) }));
  const filesChanged = files !== savedFiles;
  const shownCount = eligible.filter(current).length;

  /** Sends the changes; true once they are saved. */
  const send = async (changes: StudentVisibilityChanges) => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/student-visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!res.ok) {
        setFeedback({
          error: true,
          text: "Could not save. Refresh the page to see the current settings, then try again.",
        });
        return false;
      }
      if (changes.studentFilesVisible !== undefined) setSavedFiles(changes.studentFilesVisible);
      const savedNow = (changes.topics ?? []).map((t): [string, boolean] => [
        t.id,
        t.visibleToStudents,
      ]);
      setSavedTopics((saved) => ({
        ...saved,
        ...Object.fromEntries(savedNow),
      }));
      setTopicEdits({});
      await onSaved?.();
      setFeedback({ error: false, text: "Saved." });
      return true;
    } catch {
      setFeedback({ error: true, text: "Network error." });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // The switch is never clicked into a no-op: off (none or some shown) shows all.
  const setAllTopics = (visible: boolean) =>
    send({
      topics: eligible
        .filter((topic) => current(topic) !== visible)
        .map((topic) => ({ id: topic.id, visibleToStudents: visible })),
    });

  const saveDetails = async () => {
    const changes: StudentVisibilityChanges = {};
    if (filesChanged) changes.studentFilesVisible = files;
    if (changedTopics.length > 0) changes.topics = changedTopics;
    if (await send(changes)) setDetailsOpen(false);
  };

  const toggleDetails = (open: boolean) => {
    setDetailsOpen(open);
    setFeedback(null);
    if (!open) {
      setFiles(savedFiles);
      setTopicEdits({});
    }
  };

  const summary =
    eligible.length === 0
      ? "No approved topics yet. Add or approve them on the Topics tab."
      : shownCount === eligible.length
        ? "Students see every approved topic on the course page and in course chat."
        : shownCount === 0
          ? "Topic names are hidden from students. Course chat still answers from their files."
          : `${shownCount} of ${eligible.length} topics are shown. Choose which in File and topic settings.`;

  const feedbackText = feedback && (
    <span
      role={feedback.error ? "alert" : "status"}
      className={feedback.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
    >
      {feedback.text}
    </span>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>What students see</CardTitle>
        <CardDescription>
          Show or hide this course&apos;s topics for enrolled students.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex max-w-xl items-center justify-between gap-3 rounded-lg border p-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`student-topics-${courseId}`}>Show topics to students</Label>
            <p id={`student-topics-${courseId}-summary`} className="text-xs text-muted-foreground">
              {summary}
            </p>
          </div>
          <Switch
            id={`student-topics-${courseId}`}
            aria-describedby={`student-topics-${courseId}-summary`}
            checked={eligible.length > 0 && shownCount === eligible.length}
            onCheckedChange={setAllTopics}
            disabled={saving || eligible.length === 0}
          />
        </div>

        <div className="flex items-center gap-3">
          <Dialog open={detailsOpen} onOpenChange={toggleDetails}>
            <DialogTrigger asChild>
              <Button variant="outline">File and topic settings</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>File and topic settings</DialogTitle>
                <DialogDescription>
                  Choose whether enrolled students can browse this course&apos;s files, and which
                  topics they are shown.
                </DialogDescription>
              </DialogHeader>

              <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`student-files-${courseId}`}>Let students see course files</Label>
                  <p className="text-xs text-muted-foreground">
                    Off by default. When on, students can list and preview this course&apos;s files,
                    except ones you hid from students or scheduled for later. Course chat works
                    either way and never names a file to a student.
                  </p>
                </div>
                <Switch
                  id={`student-files-${courseId}`}
                  checked={files}
                  onCheckedChange={setFiles}
                  disabled={saving}
                />
              </div>

              <div className="grid gap-2">
                <p className="text-sm font-medium">Topics shown to students</p>
                <p className="text-xs text-muted-foreground">
                  Shown on the course page and as the topics course chat lists under an answer.
                  Hiding a topic hides its name only: chat still answers from its materials. Newly
                  approved topics are shown.
                </p>
                {eligible.length > 0 ? (
                  <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-md border p-3">
                    {eligible.map((topic) => (
                      <li key={topic.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`student-topic-${topic.id}`}
                          checked={shown(topic)}
                          onCheckedChange={(checked) =>
                            setTopicEdits((edits) => ({
                              ...edits,
                              [topic.id]: checked === true,
                            }))
                          }
                          disabled={saving}
                        />
                        <Label htmlFor={`student-topic-${topic.id}`} className="font-normal">
                          {topic.name}
                        </Label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No approved topics yet. Add or approve them on the Topics tab.
                  </p>
                )}
              </div>

              <DialogFooter className="items-center gap-3">
                {feedbackText}
                <Button
                  onClick={saveDetails}
                  disabled={saving || (!filesChanged && changedTopics.length === 0)}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {!detailsOpen && feedbackText}
        </div>
      </CardContent>
    </Card>
  );
}
