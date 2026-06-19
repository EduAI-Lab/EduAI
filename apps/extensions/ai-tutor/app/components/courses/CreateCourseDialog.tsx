import { useState, type FormEvent } from 'react';
import { Button, Input } from '@eduai/ui';
import api from '~/lib/api';

type CreateCourseDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

export function CreateCourseDialog({ open, onOpenChange, onCreated }: CreateCourseDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.createCourse({
        title: title.trim(),
        description: description.trim() || undefined,
      });
      setTitle('');
      setDescription('');
      onOpenChange(false);
      onCreated();
    } catch {
      setError('Could not create course. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-course-title"
        className="w-full max-w-md rounded-lg border bg-card p-6 shadow-md"
      >
        <h2 id="create-course-title" className="text-lg font-semibold text-foreground">
          Create course
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a new course shell, then build modules and lessons inside it.
        </p>
        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div className="space-y-2">
            <label htmlFor="course-title" className="text-sm font-medium text-foreground">
              Title
            </label>
            <Input
              id="course-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Introduction to computing"
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="course-description" className="text-sm font-medium text-foreground">
              Description
            </label>
            <Input
              id="course-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional short description"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving ? 'Creating…' : 'Create course'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
