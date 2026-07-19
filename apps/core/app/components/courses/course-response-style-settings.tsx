import { useMemo, useState } from "react";
import { IconSparkles } from "@tabler/icons-react";
import { Button } from "@eduai/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@eduai/ui";
import { Badge } from "@eduai/ui";
import { Label } from "@eduai/ui";
import { Textarea } from "@eduai/ui";
import { cn } from "@eduai/ui";
import {
  RESPONSE_STYLE_TAGS,
  resolveResponseStyleTags,
  type ResponseStyleTagId,
} from "~/lib/ai/response-style-tags";

interface CourseResponseStyleSettingsProps {
  courseId: string;
  initialTags: string[];
  initialAiInstructions?: string;
  onSaved?: (tags: string[], aiInstructions: string) => void;
  /** When true, omit the outer Card (e.g. inside another card on the Overview tab). */
  embedded?: boolean;
}

export function CourseResponseStyleSettings({
  courseId,
  initialTags,
  initialAiInstructions = "",
  onSaved,
  embedded = false,
}: CourseResponseStyleSettingsProps) {
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags);
  const [aiInstructions, setAiInstructions] = useState(initialAiInstructions);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const previewTags = useMemo(
    () => resolveResponseStyleTags(selectedTags),
    [selectedTags],
  );

  const toggleTag = (id: ResponseStyleTagId) => {
    setSelectedTags((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  };

  const save = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/response-style`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responseStyleTags: selectedTags,
          aiInstructions,
        }),
      });
      if (res.ok) {
        setSaveMsg("Saved.");
        onSaved?.(selectedTags, aiInstructions);
      } else {
        const err = await res.json().catch(() => ({}));
        setSaveMsg(err?.error ?? "Save failed.");
      }
    } catch {
      setSaveMsg("Network error.");
    } finally {
      setSaving(false);
    }
  };

  const inner = (
    <>
      <div className={embedded ? "grid gap-4" : undefined}>
        {!embedded && (
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IconSparkles className="h-5 w-5" />
              AI response style
            </CardTitle>
            <CardDescription>
              Choose how the course chatbot should respond. These preferences shape
              the AI&apos;s tone and structure — students see that AI is enabled, not
              the underlying instructions.
            </CardDescription>
          </CardHeader>
        )}
        {embedded && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
              AI response style
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              Choose how the course chatbot should respond for students.
            </p>
          </div>
        )}
        <CardContent className={embedded ? "p-0 flex flex-col gap-6" : "flex flex-col gap-6"}>
        <div className="grid gap-3">
          <Label>Style tags</Label>
          <div className="flex flex-wrap gap-2">
            {RESPONSE_STYLE_TAGS.map((tag) => {
              const active = selectedTags.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-left text-sm transition-colors",
                    active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                  aria-pressed={active}
                >
                  <span className="font-medium">{tag.label}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Select one or more tags. They combine to shape how EduAI answers in
            this course.
          </p>
        </div>

        {previewTags.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/30 p-4 grid gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Preview
            </p>
            {previewTags.map((tag) => (
              <div key={tag.id} className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{tag.label}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {tag.description}
                  </span>
                </div>
                <p className="text-[13px] text-foreground/90 whitespace-pre-wrap leading-relaxed pl-0.5">
                  {tag.exampleResponse}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-2 max-w-xl">
          <Label htmlFor="course-ai-instructions">
            Additional instructions{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Textarea
            id="course-ai-instructions"
            rows={3}
            placeholder="e.g. Prefer diagrams when explaining algorithms."
            value={aiInstructions}
            onChange={(e) => setAiInstructions(e.target.value)}
            maxLength={4000}
          />
          <p className="text-xs text-muted-foreground">
            Course-specific notes appended to the AI style. Not shown to students.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save response style"}
          </Button>
          {saveMsg && (
            <span className="text-sm text-muted-foreground">{saveMsg}</span>
          )}
        </div>
        </CardContent>
      </div>
    </>
  );

  if (embedded) {
    return inner;
  }

  return <Card>{inner}</Card>;
}

/** Read-only tag badges for the Overview tab. */
export function CourseResponseStyleSummary({
  tagIds,
  showEmpty = false,
}: {
  tagIds: string[];
  showEmpty?: boolean;
}) {
  const tags = resolveResponseStyleTags(tagIds);
  if (tags.length === 0) {
    if (!showEmpty) return null;
    return (
      <p className="text-[13px] text-muted-foreground">No response style configured</p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <Badge key={tag.id} variant="secondary">
          {tag.label}
        </Badge>
      ))}
    </div>
  );
}
