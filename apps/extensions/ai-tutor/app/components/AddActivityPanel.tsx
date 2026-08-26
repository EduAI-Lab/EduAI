/**
 * @file Modal body for instructors to author MCQ or short-text activities.
 *
 * Renders DialogHeader + form only — the parent supplies the `Dialog`/
 * `DialogContent` shell (mirrors the "Add lesson" modal so both authoring
 * flows behave the same). `onCancel` dismisses; `onActivityCreated` fires on
 * success and the parent closes the modal.
 * Responsibility: Captures a question, choices/answer, hints, topic tagging
 *   (one main + N secondary), and the AI assistance modes the student is
 *   allowed to use. POSTs to `api.createActivity` and notifies the parent.
 * Used by: `app/routes/instructor.lesson.tsx` (the lesson editor view).
 * Gotchas:
 *   - The `topics !== prevTopics` block (around line 30) uses the React
 *     "derived state during render" pattern to reset/repair the selected
 *     main+secondary topics when the topics prop reference changes (e.g.,
 *     after a topic sync). Doing this in `useEffect` would render once with
 *     stale state, then a second time after the cleanup — visibly flickering
 *     the dropdown. Comparing prev props during render and calling setState
 *     conditionally is the React-recommended fix.
 *   - At least one AI mode (Teach or Guide) MUST stay enabled. The toggles
 *     and the submit handler both enforce this client-side; the server also
 *     re-validates so a stale tab can't bypass the check.
 *   - `selectedSecondaryTopicIds` is independently de-duped against the chosen
 *     main topic on submit so changing the main topic doesn't strand a
 *     duplicate id in the secondary list.
 * Related: `app/lib/api.ts` (createActivity), `app/hooks/useCourseTopics.tsx`,
 *   `server/src/routes/activities.js`
 */

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconPlus,
  IconX,
  IconSparkles,
  IconSchool,
  IconRoute,
  IconListCheck,
  IconTag,
  IconPencil,
} from "@tabler/icons-react";
import {
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  MultiSelect,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@eduai/ui";
import { cn } from "~/lib/utils";
import api from "../lib/api";
import { useCourseTopicsContext } from "../hooks/useCourseTopics";
import { AI_MODE_REQUIRED } from "~/lib/activityForm";
import { bankQuestionToActivityDraft } from "~/lib/bankQuestionToActivityDraft";
import type { BankQuestion } from "~/lib/bankQuestionToActivityDraft";

const TYPE_OPTIONS = [
  { value: "MCQ" as const, label: "MCQ" },
  { value: "SHORT_TEXT" as const, label: "Short answer" },
];

interface AddActivityPanelProps {
  lessonId: number;
  onActivityCreated: () => void;
  /** Dismiss the modal without creating (Cancel / backdrop). */
  onCancel?: () => void;
  /**
   * Enables "Start from a bank question" mode when present. Omitted (or
   * `null`) callers keep the manual-only form — the toggle never renders.
   */
  courseOfferingId?: number | null;
}

export default function AddActivityPanel({
  lessonId,
  onActivityCreated,
  onCancel,
  courseOfferingId,
}: AddActivityPanelProps) {
  const {
    topics,
    total: topicsTotal,
    loading: loadingTopics,
    error: topicsError,
    loadMore: loadMoreTopics,
    loadingMore: loadingMoreTopics,
    refresh: refreshTopics,
  } = useCourseTopicsContext();
  const [type, setType] = useState<"MCQ" | "SHORT_TEXT">("MCQ");
  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState<string[]>(["", "", "", ""]);
  const [correct, setCorrect] = useState(0);
  const [hasSelectedCorrect, setHasSelectedCorrect] = useState(false);
  const [textAnswer, setTextAnswer] = useState("");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);

  // "Start from" a shared bank question vs. writing the prompt manually.
  // Bank mode is offered only when the caller passes `courseOfferingId`.
  const [source, setSource] = useState<"manual" | "bank">("manual");
  const [bankQuestions, setBankQuestions] = useState<BankQuestion[]>([]);
  const [bankState, setBankState] = useState<"idle" | "loading" | "error">("idle");
  // Shown as a chip once a bank question is applied; clearing it empties the
  // prefilled fields it set.
  const [bankSource, setBankSource] = useState<{ id: string; label: string } | null>(null);
  // Set when the bank question's topic name has no match in this course's
  // topic list. Never creates the topic — topic sync owns that table.
  const [unresolvedTopic, setUnresolvedTopic] = useState<string | null>(null);

  // Topic ids are opaque cuid strings on the wire (server schema is
  // z.array(z.string())), so keep them as strings — never Number() them.
  const [selectedMainTopicId, setSelectedMainTopicId] = useState<string>("");
  const [selectedSecondaryTopicIds, setSelectedSecondaryTopicIds] = useState<string[]>([]);
  const [topicSelectionError, setTopicSelectionError] = useState<string | null>(null);
  // Shown under the AI study buddy box. Was a native `alert()`, which is modal,
  // unstyled, and detached from the control that caused it.
  const [aiModeError, setAiModeError] = useState<string | null>(null);

  const [enableTeachMode, setEnableTeachMode] = useState(true);
  const [enableGuideMode, setEnableGuideMode] = useState(true);

  // Derived-state-during-render pattern (intentional): when the topics prop
  // identity changes we either clear or repair the current selection in the
  // same render so the Select never momentarily shows a stale id.
  const [prevTopics, setPrevTopics] = useState(topics);
  if (topics !== prevTopics) {
    setPrevTopics(topics);

    if (topics.length === 0) {
      if (selectedMainTopicId !== "") setSelectedMainTopicId("");
      if (selectedSecondaryTopicIds.length > 0) setSelectedSecondaryTopicIds([]);
    } else {
      // If current selection is invalid, default to first topic
      if (
        selectedMainTopicId === "" ||
        !topics.some((topic) => String(topic.id) === selectedMainTopicId)
      ) {
        setSelectedMainTopicId(String(topics[0].id));
      }
    }
  }

  const availableSecondaryTopics = useMemo(
    () => topics.filter((topic) => String(topic.id) !== selectedMainTopicId),
    [topics, selectedMainTopicId],
  );

  // Read by `applyBankQuestion`'s async re-match after `refreshTopics()`
  // resolves — a plain closure over `topics` would see the stale list from
  // the render the bank question was picked in, not the refreshed one.
  const topicsRef = useRef(topics);
  topicsRef.current = topics;

  // Guards the async `refreshTopics()` continuation in `applyBankQuestion`
  // below, mirroring the `cancelled` pattern the bank-fetch effect uses —
  // without it, closing the dialog while a refresh is in flight would call
  // setState on an unmounted component.
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (source !== "bank" || courseOfferingId == null) return;
    let cancelled = false;
    setBankState("loading");
    api
      .listBankQuestions(courseOfferingId, { limit: 20 })
      .then((questions) => {
        if (cancelled) return;
        setBankQuestions(questions);
        setBankState("idle");
      })
      .catch(() => {
        if (!cancelled) setBankState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [source, courseOfferingId]);

  const applyBankQuestion = (bankQuestion: BankQuestion) => {
    const draft = bankQuestionToActivityDraft(
      bankQuestion,
      topics.map((topic) => ({ id: String(topic.id), name: topic.name })),
    );
    setType(draft.type);
    setQuestion(draft.question);
    setChoices(draft.choices.length ? draft.choices : ["", "", "", ""]);
    setCorrect(draft.correct ?? 0);
    setHasSelectedCorrect(draft.correct !== null);
    setTextAnswer(draft.answer);
    if (draft.mainTopicId) {
      setSelectedMainTopicId(draft.mainTopicId);
      setUnresolvedTopic(null);
    } else if (draft.unresolvedTopicName) {
      // The topics list may just be stale (Core sync runs on the GET
      // /courses/:id/topics read) — refresh once and re-check before giving up.
      setUnresolvedTopic(null);
      void refreshTopics().then(() => {
        if (!mountedRef.current) return;
        const rematch = topicsRef.current.find((topic) => topic.name === draft.unresolvedTopicName);
        if (rematch) {
          setSelectedMainTopicId(String(rematch.id));
          setUnresolvedTopic(null);
        } else {
          setUnresolvedTopic(draft.unresolvedTopicName);
        }
      });
    } else {
      // Untagged bank question: neither a match nor an unresolved name.
      // Clear any previously selected topic rather than silently keeping a
      // stale one the instructor never chose for this question.
      setSelectedMainTopicId("");
      setUnresolvedTopic(null);
    }
    setBankSource({ id: bankQuestion.id, label: bankQuestion.content });
  };

  const clearBankSource = () => {
    setBankSource(null);
    setUnresolvedTopic(null);
    setQuestion("");
    setChoices(["", "", "", ""]);
    setCorrect(0);
    setHasSelectedCorrect(false);
    setTextAnswer("");
  };

  const addChoice = () => {
    setChoices((prev) => (prev.length < 8 ? [...prev, ""] : prev));
  };

  const removeChoice = (index: number) => {
    setChoices((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, i) => i !== index);
    });
    setCorrect((prevCorrect) => {
      if (index <= prevCorrect) {
        return Math.max(0, prevCorrect - 1);
      }
      return prevCorrect;
    });
  };

  const handleAddActivity = async (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim()) return;
    if (selectedMainTopicId === "") {
      setTopicSelectionError("Select a main topic to continue.");
      return;
    }

    if (!enableTeachMode && !enableGuideMode) {
      setAiModeError(AI_MODE_REQUIRED);
      return;
    }

    setBusy(true);
    setTopicSelectionError(null);
    setAiModeError(null);

    const mainTopicId = selectedMainTopicId;
    const secondaryIds = selectedSecondaryTopicIds.filter((id) => id !== mainTopicId);

    try {
      if (type === "MCQ") {
        await api.createActivity(lessonId, {
          question: question.trim(),
          type,
          options: { choices },
          answer: { correctIndex: correct },
          hints: hint.trim() ? [hint.trim()] : [],
          mainTopicId,
          secondaryTopicIds: secondaryIds,
          enableTeachMode,
          enableGuideMode,
        });
      } else {
        await api.createActivity(lessonId, {
          question: question.trim(),
          type,
          answer: { text: textAnswer.trim() },
          hints: hint.trim() ? [hint.trim()] : [],
          mainTopicId,
          secondaryTopicIds: secondaryIds,
          enableTeachMode,
          enableGuideMode,
        });
      }

      setQuestion("");
      setChoices(["", "", "", ""]);
      setCorrect(0);
      setHasSelectedCorrect(false);
      setTextAnswer("");
      setHint("");
      setSelectedSecondaryTopicIds([]);
      setEnableTeachMode(true);
      setEnableGuideMode(true);
      setBankSource(null);
      setUnresolvedTopic(null);
      onActivityCreated();
    } catch (error) {
      console.error("Failed to add activity", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add activity</DialogTitle>
        <DialogDescription>Author a new question for this lesson.</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleAddActivity} className="space-y-6">
        {courseOfferingId != null && (
          <div className="space-y-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <IconListCheck className="size-3.5 text-secondary" aria-hidden="true" />
              Start from
            </span>
            <div
              role="radiogroup"
              className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/55 p-1 shadow-sm"
            >
              <button
                type="button"
                role="radio"
                data-testid="activity-source-manual"
                data-state={source === "manual" ? "on" : "off"}
                aria-checked={source === "manual"}
                onClick={() => setSource("manual")}
                className={cn(
                  "min-w-[6.5rem] rounded-lg px-4 py-2 text-sm font-medium transition-all",
                  source === "manual"
                    ? "bg-card text-foreground shadow-[0_1px_4px_rgba(0,0,0,0.08)]"
                    : "text-muted-foreground hover:bg-card/75 hover:text-foreground",
                )}
              >
                Write my own
              </button>
              <button
                type="button"
                role="radio"
                data-testid="activity-source-bank"
                data-state={source === "bank" ? "on" : "off"}
                aria-checked={source === "bank"}
                onClick={() => setSource("bank")}
                className={cn(
                  "min-w-[6.5rem] rounded-lg px-4 py-2 text-sm font-medium transition-all",
                  source === "bank"
                    ? "bg-card text-foreground shadow-[0_1px_4px_rgba(0,0,0,0.08)]"
                    : "text-muted-foreground hover:bg-card/75 hover:text-foreground",
                )}
              >
                From the question bank
              </button>
            </div>
          </div>
        )}

        {source === "bank" && !bankSource ? (
          <div data-testid="bank-question-list" className="space-y-2">
            {bankState === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
            {bankState === "error" && (
              <p className="text-sm text-destructive">
                Could not load the question bank. Write the question yourself, or try again.
              </p>
            )}
            {bankState === "idle" && bankQuestions.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No shared questions in this course yet. In Question Maker, tick "Usable by other
                EduAI extensions" on a reviewed question.
              </p>
            )}
            {bankQuestions.map((bankQuestion) => (
              <button
                key={bankQuestion.id}
                type="button"
                data-testid={`bank-question-${bankQuestion.id}`}
                onClick={() => applyBankQuestion(bankQuestion)}
                className="w-full rounded-[var(--radius-md)] border border-border p-2 text-left"
              >
                <span className="text-sm font-medium">{bankQuestion.content}</span>
                <span className="block text-xs text-muted-foreground">
                  {bankQuestion.type === "MCQ" ? "MCQ" : "Short answer"}
                  {bankQuestion.topicName ? ` · ${bankQuestion.topicName}` : ""}
                </span>
              </button>
            ))}
            <p className="text-xs text-muted-foreground">
              Long-answer questions are not shown — an activity is MCQ or short answer.
            </p>
          </div>
        ) : null}

        {bankSource && (
          <div
            data-testid="bank-source-chip"
            className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-muted/40 px-3 py-2"
          >
            <span className="truncate text-sm">
              From the question bank: <span className="font-medium">{bankSource.label}</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="bank-source-clear"
              onClick={clearBankSource}
            >
              <IconX className="size-4" aria-hidden="true" />
              Clear
            </Button>
          </div>
        )}

        <div
          className={cn(
            "grid gap-x-6 gap-y-5 md:grid-cols-2",
            source === "bank" && !bankSource && "hidden",
          )}
        >
          {/* Left column: what's asked. */}
          <div className="space-y-5">
            <div className="space-y-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <IconListCheck className="size-3.5 text-secondary" aria-hidden="true" />
                Question type
              </span>
              <SegmentedControl value={type} onValueChange={setType} options={TYPE_OPTIONS} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-activity-question" className="flex items-center gap-1.5">
                <IconPencil className="size-3.5 text-secondary" aria-hidden="true" />
                Question prompt <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="new-activity-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Write the question learners should answer…"
                rows={4}
              />
            </div>

            {type === "MCQ" ? (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <IconListCheck className="size-3.5 text-secondary" aria-hidden="true" />
                    Choices <span className="text-destructive">*</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Click a letter to mark the correct answer
                  </span>
                </div>
                <div className="space-y-2 rounded-[var(--radius-lg)] border border-border bg-muted/40 p-3">
                  {choices.map((choice, index) => {
                    const letter = String.fromCharCode(65 + index);
                    const isCorrect = correct === index && hasSelectedCorrect;
                    return (
                      <div
                        key={index}
                        className={cn(
                          "relative flex items-center gap-3 rounded-[var(--radius-md)] border p-1.5 transition-colors",
                          isCorrect
                            ? "border-[var(--color-success-500)]/60 bg-[var(--color-success-500)]/10"
                            : "border-transparent",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setCorrect(index);
                            setHasSelectedCorrect(true);
                          }}
                          aria-pressed={isCorrect}
                          aria-label={
                            isCorrect
                              ? `Option ${letter} (correct answer)`
                              : `Mark option ${letter} correct`
                          }
                          title={isCorrect ? "Correct answer" : "Mark as correct answer"}
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isCorrect
                              ? "bg-[var(--color-success-500)] text-white"
                              : "bg-primary/15 text-foreground hover:bg-primary/30",
                          )}
                        >
                          {letter}
                        </button>
                        <Input
                          value={choice}
                          onChange={(event) =>
                            setChoices((prev) => {
                              const next = [...prev];
                              next[index] = event.target.value;
                              return next;
                            })
                          }
                          placeholder={`Option ${letter}`}
                          aria-label={`Option ${letter}`}
                          className="flex-1"
                        />
                        {choices.length > 2 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive"
                            onClick={() => removeChoice(index)}
                            aria-label={`Remove option ${letter}`}
                          >
                            <IconX className="size-4" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {choices.length < 8 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={addChoice}
                    >
                      <IconPlus className="size-4" aria-hidden="true" />
                      Add choice
                    </Button>
                  )}
                </div>
                {!hasSelectedCorrect && (
                  <p className="text-xs text-muted-foreground">No correct answer selected yet.</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="new-activity-answer" className="flex items-center gap-1.5">
                  <IconPencil className="size-3.5 text-secondary" aria-hidden="true" />
                  Expected answer
                </Label>
                <Input
                  id="new-activity-answer"
                  value={textAnswer}
                  onChange={(event) => setTextAnswer(event.target.value)}
                  placeholder="Ideal short response…"
                />
              </div>
            )}
          </div>

          {/* Right column: tagging + AI assistance. */}
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="new-activity-main-topic" className="flex items-center gap-1.5">
                <IconTag className="size-3.5 text-secondary" aria-hidden="true" />
                Main topic
              </Label>
              <Select
                value={selectedMainTopicId !== "" ? selectedMainTopicId : undefined}
                onValueChange={(value) => {
                  const newMainTopicId = value ?? "";
                  setSelectedMainTopicId(newMainTopicId);
                  // Remove new main topic from secondary topics if it was selected there
                  if (newMainTopicId) {
                    setSelectedSecondaryTopicIds((prev) =>
                      prev.filter((id) => id !== newMainTopicId),
                    );
                  }
                }}
                disabled={loadingTopics || topics.length === 0}
              >
                <SelectTrigger id="new-activity-main-topic" className="w-full">
                  <SelectValue placeholder="Select a topic…" />
                </SelectTrigger>
                <SelectContent>
                  {topics.map((topic) => (
                    <SelectItem key={topic.id} value={String(topic.id)}>
                      {topic.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {topicSelectionError && (
                <p className="text-xs text-destructive">{topicSelectionError}</p>
              )}
              {unresolvedTopic ? (
                <p className="text-xs text-muted-foreground">
                  "{unresolvedTopic}" is not in this course's topics yet — choose a main topic
                  below.
                </p>
              ) : null}
              {/* #1207: the topic list is paged. Without this the tail of a large
                course's topics would be unreachable and unmentioned. */}
              {topics.length < topicsTotal && (
                <p className="text-xs text-muted-foreground">
                  Showing {topics.length} of {topicsTotal} topics.{" "}
                  <button
                    type="button"
                    className="font-medium text-primary underline underline-offset-2 disabled:opacity-60"
                    onClick={() => void loadMoreTopics()}
                    disabled={loadingMoreTopics}
                  >
                    {loadingMoreTopics ? "Loading…" : "Load more"}
                  </button>
                </p>
              )}
              {!loadingTopics && !topicsError && topics.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No topics on this course yet. Add some on EduAI Core, then try again.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <IconTag className="size-3.5 text-secondary" aria-hidden="true" />
                Secondary topics{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </span>
              <MultiSelect
                options={availableSecondaryTopics.map((topic) => ({
                  value: String(topic.id),
                  label: topic.name,
                }))}
                value={selectedSecondaryTopicIds}
                onValueChange={setSelectedSecondaryTopicIds}
                disabled={loadingTopics || availableSecondaryTopics.length === 0}
                placeholder="Add secondary topics…"
                searchPlaceholder="Search topics…"
                emptyText="No other topics available."
                className="w-full"
              />
            </div>

            <div className="space-y-3 rounded-[var(--radius-lg)] border border-border bg-muted/40 p-4">
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-md bg-accent/15 text-accent">
                  <IconSparkles className="size-3.5" aria-hidden="true" />
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  AI study buddy
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Choose which AI assistance modes students can use for this activity.
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  {
                    key: "teach" as const,
                    label: "Teach me",
                    icon: IconSchool,
                    enabled: enableTeachMode,
                    other: enableGuideMode,
                    set: setEnableTeachMode,
                  },
                  {
                    key: "guide" as const,
                    label: "Guide me",
                    icon: IconRoute,
                    enabled: enableGuideMode,
                    other: enableTeachMode,
                    set: setEnableGuideMode,
                  },
                ].map((mode) => {
                  const ModeIcon = mode.icon;
                  return (
                    <button
                      key={mode.key}
                      type="button"
                      aria-pressed={mode.enabled}
                      onClick={() => {
                        if (mode.enabled && !mode.other) {
                          setAiModeError(AI_MODE_REQUIRED);
                          return;
                        }
                        setAiModeError(null);
                        mode.set(!mode.enabled);
                      }}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                        mode.enabled
                          ? "border-primary bg-primary text-primary-foreground shadow-[var(--shadow-2xs)]"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                      )}
                    >
                      <ModeIcon className="size-3.5" aria-hidden="true" />
                      {mode.label}
                    </button>
                  );
                })}
              </div>
              {aiModeError && (
                <p role="alert" className="text-xs text-destructive">
                  {aiModeError}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-activity-hint" className="flex items-center gap-1.5">
                <IconSparkles className="size-3.5 text-secondary" aria-hidden="true" />
                Hint{" "}
                <span className="font-normal normal-case text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="new-activity-hint"
                value={hint}
                onChange={(event) => setHint(event.target.value)}
                placeholder="Optional hint…"
              />
            </div>
          </div>
        </div>

        {topicsError && <p className="text-xs text-destructive">{topicsError}</p>}

        <DialogFooter>
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={busy || !question.trim()}>
            <IconPlus className="size-4" aria-hidden="true" />
            {busy ? "Adding…" : "Add activity"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
