import { IconPlus, IconTag, IconX } from "@tabler/icons-react";
import { useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@eduai/ui";

import type { MaterialTopic, MaterialTopicChoice } from "~/hooks/api/use-course-materials";
import { looseTopicKey, MAX_TOPICS_PER_MATERIAL } from "~/lib/topics/candidates";

/** A pick in the editor: an existing topic, or a new name not saved yet. */
type Pick = { topicId: string; name: string } | { topicId: null; name: string };

/** Wording for the save errors the topics endpoint can return. */
const ERROR_MESSAGES = {
  TOO_MANY_TOPICS: `A file can have at most ${MAX_TOPICS_PER_MATERIAL} topics.`,
  INVALID_TOPIC_NAME: "Topic names must be 1–120 characters.",
  TOPIC_NAME_TAKEN: "A removed or dismissed topic already uses that name. Choose a different name.",
  TOPIC_CREATE_FORBIDDEN: "You can't create topics in this course. Choose an existing one.",
  TOPIC_NOT_FOUND: "One of those topics was just removed. Reload and try again.",
  Forbidden: "You can't change this file's topics.",
} satisfies Record<string, string>;

/** The message for an error code the save rejected with, or a generic one. */
function saveErrorMessage(code: string): string {
  return code in ERROR_MESSAGES
    ? // SAFETY: the `in` check above proves `code` is one of the table's keys.
      ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES]
    : "Couldn't save topics. Please try again.";
}

type MaterialTopicsEditorProps = {
  /** The material's current topics, main topic first. */
  topics: MaterialTopic[];
  /** The course's accepted topics, offered as choices. */
  courseTopics: MaterialTopic[];
  /** Omitted when the viewer can't change this material's topics: tags only. */
  onSave?: (choices: MaterialTopicChoice[]) => Promise<void>;
  /** Whether the viewer may type a new topic name. */
  canCreate?: boolean;
  /** Shown instead of "No topic" while the file is still processing. */
  pendingLabel?: string;
};

/**
 * A material's topics as tags, with a picker to change them (#1965).
 *
 * Up to `MAX_TOPICS_PER_MATERIAL`; the first is the main topic. A typed name
 * that matches an existing topic (ignoring case, punctuation, and plurals)
 * selects that topic instead of creating a near-duplicate; the server applies
 * the same rule.
 */
export function MaterialTopicsEditor({
  topics,
  courseTopics,
  onSave,
  canCreate = false,
  pendingLabel,
}: MaterialTopicsEditorProps) {
  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const full = picks.length >= MAX_TOPICS_PER_MATERIAL;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setPicks(topics.map((topic) => ({ topicId: topic.id, name: topic.name })));
      setNewName("");
      setError(null);
    }
  };

  const isPicked = (topicId: string) => picks.some((pick) => pick.topicId === topicId);

  const toggle = (topic: MaterialTopic, checked: boolean) => {
    setPicks((current) =>
      checked
        ? current.length >= MAX_TOPICS_PER_MATERIAL || isPicked(topic.id)
          ? current
          : [...current, { topicId: topic.id, name: topic.name }]
        : current.filter((pick) => pick.topicId !== topic.id),
    );
  };

  const addNew = () => {
    const name = newName.replace(/\s+/g, " ").trim();
    if (!name || full) return;
    const key = looseTopicKey(name);
    const existing = courseTopics.find((topic) => looseTopicKey(topic.name) === key);
    if (existing) {
      toggle(existing, true);
    } else if (!picks.some((pick) => looseTopicKey(pick.name) === key)) {
      setPicks((current) => [...current, { topicId: null, name }]);
    }
    setNewName("");
  };

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(
        picks.map((pick) => (pick.topicId ? { topicId: pick.topicId } : { name: pick.name })),
      );
      setOpen(false);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setError(saveErrorMessage(code));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {topics.length > 0 ? (
        topics.map((topic, index) => (
          <Badge
            key={topic.id}
            variant={index === 0 ? "secondary" : "outline"}
            size="sm"
            title={index === 0 ? "Main topic" : undefined}
          >
            {topic.name}
          </Badge>
        ))
      ) : (
        <span className="text-[11px] text-muted-foreground">{pendingLabel ?? "No topic"}</span>
      )}

      {onSave && (
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]">
              <IconTag className="mr-1 h-3 w-3" />
              {topics.length > 0 ? "Edit topics" : "Add topic"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80">
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-sm font-medium">Topics for this file</p>
                <p className="text-xs text-muted-foreground">
                  Up to {MAX_TOPICS_PER_MATERIAL}. The first one is the main topic.
                </p>
              </div>

              {picks.length > 0 && (
                <ol className="flex flex-wrap gap-1" aria-label="Chosen topics">
                  {picks.map((pick, index) => (
                    <li key={pick.topicId ?? `new:${pick.name}`}>
                      <Badge variant={index === 0 ? "secondary" : "outline"} className="gap-1">
                        {pick.name}
                        {pick.topicId === null && (
                          <span className="text-muted-foreground">(new)</span>
                        )}
                        <button
                          type="button"
                          aria-label={`Remove ${pick.name}`}
                          className="rounded-sm hover:text-destructive"
                          onClick={() => setPicks((current) => current.filter((p) => p !== pick))}
                        >
                          <IconX className="h-3 w-3" />
                        </button>
                      </Badge>
                    </li>
                  ))}
                </ol>
              )}

              {courseTopics.length > 0 ? (
                <div className="max-h-48 overflow-y-auto rounded-md border p-2">
                  {courseTopics.map((topic) => {
                    const id = `material-topic-${topic.id}`;
                    const checked = isPicked(topic.id);
                    return (
                      <div key={topic.id} className="flex items-center gap-2 py-1">
                        <Checkbox
                          id={id}
                          checked={checked}
                          disabled={!checked && full}
                          onCheckedChange={(value) => toggle(topic, value === true)}
                        />
                        <Label htmlFor={id} className="font-normal">
                          {topic.name}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">This course has no topics yet.</p>
              )}

              {canCreate && (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addNew();
                  }}
                >
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="New topic"
                    aria-label="New topic name"
                    maxLength={120}
                    disabled={full}
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    disabled={full || !newName.trim()}
                  >
                    <IconPlus className="h-4 w-4" />
                    Add
                  </Button>
                </form>
              )}

              {error && <p className="text-xs text-destructive">{error}</p>}

              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
