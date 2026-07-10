/**
 * @file Inline form for instructors to author MCQ or short-text activities.
 *
 * Responsibility: Captures a question, choices/answer, hints, topic tagging
 *   (one main + N secondary), and the AI assistance modes the student is
 *   allowed to use. POSTs to `api.createActivity` and notifies the parent.
 * Used by: `app/routes/instructor.topic.tsx` (the lesson editor view).
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

import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  SegmentedControl,
  Textarea,
} from '@eduai/ui';
import { cn } from '~/lib/utils';
import api from '../lib/api';
import { useCourseTopicsContext } from '../hooks/useCourseTopics';

const SELECT_CLASSES =
  'flex h-9 w-full rounded-[var(--radius-md)] border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 ease-in-out focus-visible:border-ring focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-50';

const TYPE_OPTIONS = [
  { value: 'MCQ' as const, label: 'MCQ' },
  { value: 'SHORT_TEXT' as const, label: 'Short answer' },
];

interface AddActivityPanelProps {
  lessonId: number;
  onActivityCreated: () => void;
}

export default function AddActivityPanel({ lessonId, onActivityCreated }: AddActivityPanelProps) {
  const { topics, loading: loadingTopics, error: topicsError } = useCourseTopicsContext();
  const [type, setType] = useState<'MCQ' | 'SHORT_TEXT'>('MCQ');
  const [question, setQuestion] = useState('');
  const [choices, setChoices] = useState<string[]>(['', '', '', '']);
  const [correct, setCorrect] = useState(0);
  const [hasSelectedCorrect, setHasSelectedCorrect] = useState(false);
  const [textAnswer, setTextAnswer] = useState('');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);

  const [selectedMainTopicId, setSelectedMainTopicId] = useState<number | ''>('');
  const [selectedSecondaryTopicIds, setSelectedSecondaryTopicIds] = useState<number[]>([]);
  const [topicSelectionError, setTopicSelectionError] = useState<string | null>(null);

  const [enableTeachMode, setEnableTeachMode] = useState(true);
  const [enableGuideMode, setEnableGuideMode] = useState(true);

  // Derived-state-during-render pattern (intentional): when the topics prop
  // identity changes we either clear or repair the current selection in the
  // same render so the <select> never momentarily shows a stale id.
  const [prevTopics, setPrevTopics] = useState(topics);
  if (topics !== prevTopics) {
    setPrevTopics(topics);

    if (topics.length === 0) {
      if (selectedMainTopicId !== '') setSelectedMainTopicId('');
      if (selectedSecondaryTopicIds.length > 0) setSelectedSecondaryTopicIds([]);
    } else {
      // If current selection is invalid, default to first topic
      if (selectedMainTopicId === '' || !topics.some((topic) => topic.id === selectedMainTopicId)) {
        setSelectedMainTopicId(topics[0].id);
      }
    }
  }

  const availableSecondaryTopics = useMemo(
    () =>
      topics.filter(
        (topic) =>
          topic.id !== (typeof selectedMainTopicId === 'number' ? selectedMainTopicId : -1),
      ),
    [topics, selectedMainTopicId],
  );

  const toggleSecondaryForNew = (topicId: number) => {
    setSelectedSecondaryTopicIds((prev) => {
      if (prev.includes(topicId)) {
        return prev.filter((id) => id !== topicId);
      }
      return [...prev, topicId];
    });
  };

  const handleAddActivity = async (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim()) return;
    if (selectedMainTopicId === '') {
      setTopicSelectionError('Select a main topic to continue.');
      return;
    }

    if (!enableTeachMode && !enableGuideMode) {
      alert('At least one AI mode must be enabled');
      return;
    }

    setBusy(true);
    setTopicSelectionError(null);

    const mainTopicId = Number(selectedMainTopicId);
    const secondaryIds = selectedSecondaryTopicIds.filter((id) => id !== mainTopicId);

    try {
      if (type === 'MCQ') {
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

      setQuestion('');
      setChoices(['', '', '', '']);
      setCorrect(0);
      setHasSelectedCorrect(false);
      setTextAnswer('');
      setHint('');
      setSelectedSecondaryTopicIds([]);
      setEnableTeachMode(true);
      setEnableGuideMode(true);
      onActivityCreated();
    } catch (error) {
      console.error('Failed to add activity', error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add activity</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleAddActivity} className="space-y-4">
          <SegmentedControl value={type} onValueChange={setType} options={TYPE_OPTIONS} />

          <div className="space-y-2">
            <Label htmlFor="new-activity-question">Question prompt</Label>
            <Textarea
              id="new-activity-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Write the question learners should answer…"
              rows={4}
            />
          </div>

          {type === 'MCQ' ? (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-muted-foreground">Choices</div>
              <div className="space-y-2">
                {choices.map((choice, index) => {
                  const isSelected = correct === index && hasSelectedCorrect;
                  return (
                    <label
                      key={index}
                      className={cn(
                        'flex items-center gap-3 rounded-[var(--radius-lg)] border bg-card px-3 py-2.5 transition cursor-pointer focus-within:outline-none',
                        isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50',
                      )}
                    >
                      <input
                        type="radio"
                        name="correct"
                        className="sr-only"
                        checked={correct === index}
                        onChange={() => {
                          setCorrect(index);
                          setHasSelectedCorrect(true);
                        }}
                      />
                      <span className="w-6 text-xs font-semibold text-muted-foreground">
                        {String.fromCharCode(65 + index)}.
                      </span>
                      <input
                        value={choice}
                        onChange={(event) =>
                          setChoices((prev) => {
                            const next = [...prev];
                            next[index] = event.target.value;
                            return next;
                          })
                        }
                        placeholder="Option text"
                        className="min-w-0 flex-1 border-none bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="new-activity-answer">Expected answer</Label>
              <Input
                id="new-activity-answer"
                value={textAnswer}
                onChange={(event) => setTextAnswer(event.target.value)}
                placeholder="Ideal short response…"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="new-activity-main-topic">Main topic</Label>
            <select
              id="new-activity-main-topic"
              value={selectedMainTopicId === '' ? '' : selectedMainTopicId}
              onChange={(event) => {
                const newMainTopicId = event.target.value ? Number(event.target.value) : '';
                setSelectedMainTopicId(newMainTopicId);
                // Remove new main topic from secondary topics if it was selected there
                if (typeof newMainTopicId === 'number') {
                  setSelectedSecondaryTopicIds((prev) => prev.filter((id) => id !== newMainTopicId));
                }
              }}
              disabled={loadingTopics || topics.length === 0}
              className={SELECT_CLASSES}
            >
              <option value="">Select a topic…</option>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </select>
            {topicSelectionError && <p className="text-xs text-destructive">{topicSelectionError}</p>}
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-semibold text-muted-foreground">
              Secondary topics (optional)
            </span>
            <div className="flex flex-wrap gap-2">
              {availableSecondaryTopics.length === 0 ? (
                <span className="text-xs text-muted-foreground">No other topics available.</span>
              ) : (
                availableSecondaryTopics.map((topic) => {
                  const checked = selectedSecondaryTopicIds.includes(topic.id);
                  return (
                    <label
                      key={topic.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition',
                        checked
                          ? 'border-transparent bg-accent text-accent-foreground shadow-xs'
                          : 'border-border bg-secondary hover:border-accent/50',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() => toggleSecondaryForNew(topic.id)}
                      />
                      {topic.name}
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="space-y-2 rounded-[var(--radius-lg)] border border-border bg-muted/30 p-3">
            <span className="block text-xs font-semibold text-foreground">AI Study Buddy modes</span>
            <p className="text-xs text-muted-foreground">
              Choose which AI assistance modes students can use for this activity.
            </p>
            <div className="space-y-2 pt-1">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={enableTeachMode}
                  onCheckedChange={(checked) => {
                    if (!checked && !enableGuideMode) {
                      alert('At least one AI mode must be enabled');
                      return;
                    }
                    setEnableTeachMode(Boolean(checked));
                  }}
                />
                <span className="text-sm text-foreground">
                  Teach me — conceptual learning about topics
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={enableGuideMode}
                  onCheckedChange={(checked) => {
                    if (!checked && !enableTeachMode) {
                      alert('At least one AI mode must be enabled');
                      return;
                    }
                    setEnableGuideMode(Boolean(checked));
                  }}
                />
                <span className="text-sm text-foreground">
                  Guide me — step-by-step guidance on this question
                </span>
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-activity-hint">Hint (optional)</Label>
            <Input
              id="new-activity-hint"
              value={hint}
              onChange={(event) => setHint(event.target.value)}
              placeholder="Optional hint…"
            />
          </div>

          <Button type="submit" className="w-full" disabled={busy || !question.trim()}>
            {busy ? 'Adding…' : 'Add activity'}
          </Button>

          {topicsError && <p className="text-xs text-destructive">{topicsError}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
