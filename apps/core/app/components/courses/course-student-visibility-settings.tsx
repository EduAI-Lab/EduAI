import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Label,
  Switch,
} from "@eduai/ui";

import type { CourseTopic } from "~/hooks/api/use-course-topics";

interface CourseStudentVisibilitySettingsProps {
  courseId: string;
  studentFilesVisible: boolean;
  topics: CourseTopic[];
  /** Refetches the topics after a save, so the checkboxes show what was stored. */
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
 * What enrolled students see in a course (#2002): its files, and which approved
 * topics are shown on the course page and in course chat.
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
  const [topicEdits, setTopicEdits] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);

  // Only an approved topic can be shown to students; Uncategorized never is.
  const eligible = topics.filter(
    (topic) => topic.reviewStatus === "ACCEPTED" && topic.name !== "Uncategorized",
  );
  const shown = (topic: CourseTopic) => topicEdits[topic.id] ?? stored(topic);
  const changedTopics = eligible
    .filter((topic) => shown(topic) !== stored(topic))
    .map((topic) => ({ id: topic.id, visibleToStudents: shown(topic) }));
  const filesChanged = files !== savedFiles;

  const save = async () => {
    const changes: StudentVisibilityChanges = {};
    if (filesChanged) changes.studentFilesVisible = files;
    if (changedTopics.length > 0) changes.topics = changedTopics;
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
        return;
      }
      setSavedFiles(files);
      await onSaved?.();
      setTopicEdits({});
      setFeedback({ error: false, text: "Saved." });
    } catch {
      setFeedback({ error: true, text: "Network error." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>What students see</CardTitle>
        <CardDescription>
          Choose whether enrolled students can browse this course&apos;s files, and which topics
          they are shown.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex max-w-xl items-center justify-between gap-3 rounded-lg border p-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`student-files-${courseId}`}>Let students see course files</Label>
            <p className="text-xs text-muted-foreground">
              Off by default. When on, students can list and preview this course&apos;s files,
              except ones you hid from students or scheduled for later. Course chat works either way
              and never names a file to a student.
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
            Shown on the course page and as the topics course chat lists under an answer. Hiding a
            topic hides its name only: chat still answers from its materials. Newly approved topics
            are shown.
          </p>
          {eligible.length > 0 ? (
            <ul className="flex max-h-64 max-w-xl flex-col gap-2 overflow-y-auto rounded-md border p-3">
              {eligible.map((topic) => (
                <li key={topic.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`student-topic-${topic.id}`}
                    checked={shown(topic)}
                    onCheckedChange={(checked) =>
                      setTopicEdits((edits) => ({ ...edits, [topic.id]: checked === true }))
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

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving || (!filesChanged && changedTopics.length === 0)}>
            {saving ? "Saving…" : "Save what students see"}
          </Button>
          {feedback && (
            <span
              role={feedback.error ? "alert" : "status"}
              className={
                feedback.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"
              }
            >
              {feedback.text}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
