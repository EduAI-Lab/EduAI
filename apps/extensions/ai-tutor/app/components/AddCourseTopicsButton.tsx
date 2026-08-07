import type { FormEvent } from 'react';
import { useState } from 'react';
import { Button, Input } from '@eduai/ui';
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
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-full"
        onClick={toggle}
        disabled={buttonDisabled}
      >
        {open ? 'Cancel' : 'Add topic'}
      </Button>
      {open && (
        <form onSubmit={handleSubmit} className="space-y-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New topic name…"
            autoFocus
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !name.trim()}>
              {busy ? 'Adding…' : 'Save topic'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
