import type { FormEvent } from 'react';
import { useState } from 'react';
import { useCourseTopicsContext } from '../hooks/useCourseTopics';

type AddCourseTopicsButtonProps = {
  disabled?: boolean;
};

export default function AddCourseTopicsButton({ disabled = false }: AddCourseTopicsButtonProps) {
  const { createTopic } = useCourseTopicsContext();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = () => {
    if (disabled || busy) return;
    setError(null);
    setOpen((current) => {
      if (current) {
        setName('');
      }
      return !current;
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Topic name is required.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await createTopic(trimmed);
      setName('');
      setOpen(false);
    } catch (err) {
      console.error('Failed to create topic', err);
      setError('Could not create topic. Try a different name.');
    } finally {
      setBusy(false);
    }
  };

  const buttonDisabled = disabled || busy;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={toggle}
        disabled={buttonDisabled}
        className="w-full px-3 py-2 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 text-white text-sm font-semibold disabled:opacity-50"
      >
        {open ? 'Cancel' : 'Add Topic'}
      </button>
      {open && (
        <form onSubmit={handleSubmit} className="space-y-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New topic name…"
            className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-transparent"
          />
          {error && <p className="text-xs text-rose-500">{error}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold disabled:opacity-40"
            >
              {busy ? 'Adding…' : 'Save Topic'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
