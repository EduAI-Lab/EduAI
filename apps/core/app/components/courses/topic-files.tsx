import { IconFile, IconLink, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@eduai/ui";

import {
  fetchAllCourseMaterials,
  fetchCourseMaterialsByIds,
} from "~/hooks/api/course-material-lookup";
import type { CourseTopic } from "~/hooks/api/use-course-topics";
import type {
  CourseMaterial,
  MaterialTopic,
  MaterialTopicChoice,
} from "~/hooks/api/use-course-materials";
import { MAX_TOPICS_PER_MATERIAL } from "~/lib/topics/candidates";
import { hasTopic, topicsWithAdded, topicsWithRemoved } from "~/lib/topics/topic-links";

type SetMaterialTopics = (
  materialId: string,
  topics: MaterialTopicChoice[],
) => Promise<MaterialTopic[]>;

type TopicFilesProps = {
  courseId: string;
  topic: CourseTopic;
  /** Omitted when the viewer can't change any file's topics: the list only. */
  onSetMaterialTopics?: SetMaterialTopics;
  /** Whether the viewer may change this file's topics (the Materials tab's rule). */
  canEditFile: (material: CourseMaterial) => boolean;
  /** Re-read the topics after a change, so the file lists and counts follow. */
  onChanged?: () => Promise<void> | void;
};

/** Server error codes worth explaining; anything else gets the generic line. */
const SAVE_ERRORS = {
  TOO_MANY_TOPICS: `That file already has ${MAX_TOPICS_PER_MATERIAL} topics.`,
  Forbidden: "You can't change that file's topics.",
  MATERIAL_NOT_FOUND: "That file was removed. Reload and try again.",
  TOPIC_NOT_FOUND: "This topic was just removed. Reload and try again.",
} satisfies Record<string, string>;

/** The message for an error code a save rejected with, or a generic one. */
function saveError(code: string): string {
  return code in SAVE_ERRORS
    ? // SAFETY: the `in` check above proves `code` is one of the table's keys.
      SAVE_ERRORS[code as keyof typeof SAVE_ERRORS]
    : "Couldn't save. Please try again.";
}

/**
 * A topic's files on the Topics tab (#1997): the files filed under it, each
 * unlinkable, a "No files yet" flag when there are none, and "Link files" to
 * choose files from the topic's side. Changes go through the same per-file
 * save as the Materials tab, so the 3-topic cap and permissions are the same.
 */
export function TopicFiles({
  courseId,
  topic,
  onSetMaterialTopics,
  canEditFile,
  onChanged,
}: TopicFilesProps) {
  const sources = topic.sources ?? [];
  const total = topic.sourceCount ?? sources.length;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const unlink = async (materialId: string) => {
    if (!onSetMaterialTopics) return;
    setBusyId(materialId);
    setError(null);
    try {
      // The file may be on a page the Materials tab hasn't loaded, so its other
      // topics are read fresh rather than taken from the page.
      const [material] = await fetchCourseMaterialsByIds(courseId, [materialId]);
      if (!material) throw new Error("MATERIAL_NOT_FOUND");
      if (!canEditFile(material)) throw new Error("Forbidden");
      await onSetMaterialTopics(materialId, topicsWithRemoved(material.topics ?? [], topic.id));
      await onChanged?.();
    } catch (e) {
      setError(saveError(e instanceof Error ? e.message : ""));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {total === 0 ? (
          <Badge variant="outline" size="sm" className="text-amber-700 dark:text-amber-400">
            No files yet
          </Badge>
        ) : (
          <>
            {sources.map((source) => (
              <Badge key={source.materialId} variant="outline" size="sm" className="gap-1">
                <IconFile className="h-3 w-3" aria-hidden />
                <span className="max-w-48 truncate">{source.title ?? "Untitled file"}</span>
                {onSetMaterialTopics && (
                  <button
                    type="button"
                    aria-label={`Unlink ${source.title ?? "file"} from ${topic.name}`}
                    className="rounded-sm hover:text-destructive disabled:opacity-50"
                    disabled={busyId !== null}
                    onClick={() => void unlink(source.materialId)}
                  >
                    <IconX className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
            {total > sources.length && (
              <span className="text-[11px] text-muted-foreground">
                and {total - sources.length} more
              </span>
            )}
          </>
        )}
        {onSetMaterialTopics && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[11px]"
            onClick={() => setPickerOpen(true)}
          >
            <IconLink className="mr-1 h-3 w-3" />
            Link files
          </Button>
        )}
      </div>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {onSetMaterialTopics && (
        <LinkFilesDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          courseId={courseId}
          topic={topic}
          onSetMaterialTopics={onSetMaterialTopics}
          canEditFile={canEditFile}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

type LinkFilesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  topic: CourseTopic;
  onSetMaterialTopics: SetMaterialTopics;
  canEditFile: TopicFilesProps["canEditFile"];
  onChanged?: TopicFilesProps["onChanged"];
};

/** Tick the course's files that belong under a topic, then save the changes. */
function LinkFilesDialog({
  open,
  onOpenChange,
  courseId,
  topic,
  onSetMaterialTopics,
  canEditFile,
  onChanged,
}: LinkFilesDialogProps) {
  const [files, setFiles] = useState<CourseMaterial[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFiles(null);
    setLoadError(null);
    setSearch("");
    setSaveErrors([]);
    fetchAllCourseMaterials(courseId)
      .then(({ materials, truncated: more }) => {
        if (cancelled) return;
        setFiles(materials);
        setTruncated(more);
        setChosen(
          new Set(materials.filter((m) => hasTopic(m.topics ?? [], topic.id)).map((m) => m.id)),
        );
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't load the course's files. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, courseId, topic.id]);

  const query = search.trim().toLowerCase();
  const shown = (files ?? []).filter((file) => !query || file.title.toLowerCase().includes(query));

  /** Why a file can't be ticked, or null when it can be. */
  const lockReason = (file: CourseMaterial): string | null => {
    const linked = hasTopic(file.topics ?? [], topic.id);
    if (!canEditFile(file)) return "You can't change this file's topics";
    if (!linked && (file.topics?.length ?? 0) >= MAX_TOPICS_PER_MATERIAL) {
      return `Already has ${MAX_TOPICS_PER_MATERIAL} topics`;
    }
    return null;
  };

  const changes = (files ?? []).filter(
    (file) => hasTopic(file.topics ?? [], topic.id) !== chosen.has(file.id),
  );

  const save = async () => {
    setSaving(true);
    setSaveErrors([]);
    const failed: string[] = [];
    for (const file of changes) {
      const next = chosen.has(file.id)
        ? topicsWithAdded(file.topics ?? [], topic.id)
        : topicsWithRemoved(file.topics ?? [], topic.id);
      try {
        if (next === null) throw new Error("TOO_MANY_TOPICS");
        await onSetMaterialTopics(file.id, next);
      } catch (e) {
        failed.push(`${file.title}: ${saveError(e instanceof Error ? e.message : "")}`);
      }
    }
    setSaving(false);
    await onChanged?.();
    if (failed.length === 0) onOpenChange(false);
    else setSaveErrors(failed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Files for “{topic.name}”</DialogTitle>
          <DialogDescription>
            Tick the files this topic covers. A file can have up to {MAX_TOPICS_PER_MATERIAL}{" "}
            topics; a topic you add here comes after its existing ones.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p className="text-sm text-destructive" role="alert">
            {loadError}
          </p>
        ) : files === null ? (
          <p className="text-sm text-muted-foreground">Loading files…</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground">This course has no files yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${files.length} ${files.length === 1 ? "file" : "files"}`}
              aria-label="Search files"
            />
            <div
              className="max-h-80 overflow-y-auto overscroll-contain rounded-md border p-2"
              role="group"
              aria-label="Course files"
            >
              {shown.length === 0 && (
                <p className="py-1 text-xs text-muted-foreground">No file matches.</p>
              )}
              {shown.map((file) => {
                const id = `topic-file-${topic.id}-${file.id}`;
                const reason = lockReason(file);
                return (
                  <div key={file.id} className="flex items-center gap-2 py-1">
                    <Checkbox
                      id={id}
                      checked={chosen.has(file.id)}
                      disabled={reason !== null}
                      onCheckedChange={(value) =>
                        setChosen((current) => {
                          const next = new Set(current);
                          if (value === true) next.add(file.id);
                          else next.delete(file.id);
                          return next;
                        })
                      }
                    />
                    <Label htmlFor={id} className="min-w-0 flex-1 font-normal">
                      <span className="block truncate">{file.title}</span>
                      {reason && (
                        <span className="block text-[11px] text-muted-foreground">{reason}</span>
                      )}
                    </Label>
                  </div>
                );
              })}
            </div>
            {truncated && (
              <p className="text-[11px] text-muted-foreground">
                Showing the course's first {files.length} files.
              </p>
            )}
          </div>
        )}

        {saveErrors.length > 0 && (
          <ul className="space-y-1 text-xs text-destructive" role="alert">
            {saveErrors.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || changes.length === 0}>
            {saving
              ? "Saving…"
              : changes.length > 0
                ? `Save ${changes.length} change${changes.length === 1 ? "" : "s"}`
                : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
