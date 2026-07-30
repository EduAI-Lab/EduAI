/**
 * Banks tab: manage Core-owned question banks for this course.
 * Clicking a bank opens `/courses/:courseId/banks/:bankId` (same pattern as assessments).
 */
import { useState } from 'react';
import {
  Button,
  EmptyState,
  Input,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@eduai/ui';
import {
  IconPlus,
  IconRefresh,
  IconStack2,
  IconArrowRight,
} from '@tabler/icons-react';
import type { QuestionBank } from '../../services/questionBankService';

interface CourseBanksTabProps {
  banks: QuestionBank[];
  canWrite: boolean;
  isLoading?: boolean;
  loadError?: string | null;
  onCreateBank: (name: string) => Promise<void> | void;
  onSyncFromCanvas: () => void;
  onOpenBank: (bankId: string) => void;
}

export function CourseBanksTab({
  banks,
  canWrite,
  isLoading = false,
  loadError = null,
  onCreateBank,
  onSyncFromCanvas,
  onOpenBank,
}: CourseBanksTabProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed || isSaving) return;
    setIsSaving(true);
    try {
      await onCreateBank(trimmed);
      setNewName('');
      setIsCreating(false);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-[var(--radius-xl)] border border-border bg-card" />
        <div className="h-24 animate-pulse rounded-[var(--radius-xl)] border border-border bg-card" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Question banks</h2>
          <p className="text-sm text-muted-foreground">
            Named banks live in EduAI Core. Open a bank to view and add questions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && !isCreating && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsCreating(true)}
              data-testid="banks-tab-new-bank"
            >
              <IconPlus className="h-4 w-4 mr-1" />
              New bank
            </Button>
          )}
          {canWrite && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onSyncFromCanvas}
              data-testid="sync-canvas-bank-btn"
            >
              <IconRefresh className="h-4 w-4 mr-1" />
              Sync from Canvas
            </Button>
          )}
        </div>
      </div>

      {canWrite && isCreating && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="New bank name"
            placeholder="Bank name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
              if (e.key === 'Escape') {
                setIsCreating(false);
                setNewName('');
              }
            }}
            className="max-w-xs"
            autoFocus
          />
          <Button type="button" size="sm" disabled={isSaving || !newName.trim()} onClick={() => void handleCreate()}>
            Create
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setIsCreating(false);
              setNewName('');
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {loadError && (
        <p className="text-sm text-destructive" role="alert">
          {loadError}
        </p>
      )}

      {!loadError && banks.length === 0 ? (
        <EmptyState
          icon={<IconStack2 className="size-6" />}
          title="No question banks yet"
          description={
            canWrite
              ? 'Create a named bank or sync one from Canvas. A default course bank is created when Core is linked.'
              : 'No banks are available for this course.'
          }
          bare={false}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="banks-tab-list">
          {banks.map((bank) => (
            <li key={bank.id}>
              <Card
                role="button"
                tabIndex={0}
                className="cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onOpenBank(bank.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenBank(bank.id);
                  }
                }}
              >
                <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-base font-medium leading-snug">
                    {bank.name}
                  </CardTitle>
                  {bank.isDefault && <Badge variant="secondary">Default</Badge>}
                </CardHeader>
                <CardContent className="space-y-3">
                  {bank.description ? (
                    <p className="text-sm text-muted-foreground line-clamp-2">{bank.description}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">No description</p>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenBank(bank.id);
                    }}
                  >
                    Open bank
                    <IconArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
