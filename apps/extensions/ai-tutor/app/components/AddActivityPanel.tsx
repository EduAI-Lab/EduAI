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
import api from '../lib/api';
import { useCourseTopicsContext } from '../hooks/useCourseTopics';
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
    <form onSubmit={handleAddActivity} className="card-editorial p-5 space-y-4">
      <div className="font-semibold text-foreground">Add Activity</div>
      <div className="flex gap-2 text-sm">
        <label
          className={`px-3 py-1.5 rounded-full cursor-pointer transition ${
            type === 'MCQ'
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-muted'
          }`}
        >
          <input
            type="radio"
            name="type"
            className="sr-only"
            checked={type === 'MCQ'}
            onChange={() => setType('MCQ')}
          />
          MCQ
        </label>
        <label
          className={`px-3 py-1.5 rounded-full cursor-pointer transition ${
            type === 'SHORT_TEXT'
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-muted'
          }`}
        >
          <input
            type="radio"
            name="type"
            className="sr-only"
            checked={type === 'SHORT_TEXT'}
            onChange={() => setType('SHORT_TEXT')}
          />
          Short answer
        </label>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground">Question prompt</label>
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Write the question learners should answer…"
          rows={4}
          className="input-field"
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
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition focus-within:outline-none bg-card ${
                    isSelected
                      ? 'border-primary ring-2 ring-primary/20'
                      : 'border-border hover:border-primary/50'
                  }`}
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
                  <span className="text-xs font-semibold text-muted-foreground w-6">
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
                    className="flex-1 min-w-0 border-none bg-transparent focus:outline-none text-foreground placeholder:text-muted-foreground"
                  />
                </label>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground">Expected answer</label>
          <input
            value={textAnswer}
            onChange={(event) => setTextAnswer(event.target.value)}
            placeholder="Ideal short response…"
            className="input-field"
          />
        </div>
      )}

      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground">Main topic</label>
        <select
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
          className="input-field text-sm"
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
        <span className="text-xs font-semibold text-muted-foreground block">
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
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs cursor-pointer transition ${
                    checked
                      ? 'border-transparent bg-accent text-accent-foreground shadow-sm'
                      : 'border-border bg-secondary hover:border-accent/50'
                  }`}
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

      <div className="space-y-2 pt-1">
        <span className="text-xs font-semibold text-muted-foreground block">
          AI Study Buddy Modes
        </span>
        <p className="text-xs text-muted-foreground">
          Choose which AI assistance modes students can use for this activity.
        </p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enableTeachMode}
              onChange={(e) => {
                if (!e.target.checked && !enableGuideMode) {
                  alert('At least one AI mode must be enabled');
                  return;
                }
                setEnableTeachMode(e.target.checked);
              }}
              className="rounded border-primary/50 text-primary focus:ring-primary"
            />
            <span className="text-sm text-foreground">
              Teach me - Conceptual learning about topics
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enableGuideMode}
              onChange={(e) => {
                if (!e.target.checked && !enableTeachMode) {
                  alert('At least one AI mode must be enabled');
                  return;
                }
                setEnableGuideMode(e.target.checked);
              }}
              className="rounded border-primary/50 text-primary focus:ring-primary"
            />
            <span className="text-sm text-foreground">
              Guide me - Step-by-step guidance on this question
            </span>
          </label>
        </div>
      </div>

      <input
        value={hint}
        onChange={(event) => setHint(event.target.value)}
        placeholder="Optional hint…"
        className="input-field"
      />

      <button type="submit" disabled={busy || !question.trim()} className="w-full btn-primary">
        {busy ? 'Adding…' : 'Add Activity'}
      </button>

      {topicsError && <p className="text-xs text-destructive">{topicsError}</p>}
    </form>
  );
}
