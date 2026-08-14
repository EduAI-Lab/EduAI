/**
 * Bank selector for the Questions tab: switch banks, create a new named bank.
 */
import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
  Input,
} from '@eduai/ui';
import { IconPlus } from '@tabler/icons-react';
import { QuestionBank } from '../../services/questionBankService';

const ALL_QUESTIONS_VALUE = '__all__';

interface BankSelectorProps {
  banks: QuestionBank[];
  selectedBankId: string | null;
  /** null = all questions in the course */
  onBankChange: (bankId: string | null) => void;
  onCreateBank: (name: string) => Promise<void> | void;
  disabled?: boolean;
}

export const BankSelector = ({
  banks,
  selectedBankId,
  onBankChange,
  onCreateBank,
  disabled = false,
}: BankSelectorProps) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const selectValue =
    selectedBankId == null ? ALL_QUESTIONS_VALUE : selectedBankId;

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

  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="bank-selector">
      <div className="min-w-[220px]">
        <Select
          value={selectValue}
          onValueChange={(value) => {
            if (value === ALL_QUESTIONS_VALUE) {
              onBankChange(null);
            } else {
              onBankChange(value);
            }
          }}
          disabled={disabled}
        >
          <SelectTrigger aria-label="Question bank">
            <SelectValue placeholder="Select bank" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_QUESTIONS_VALUE}>All questions</SelectItem>
            {banks.map((bank) => (
              <SelectItem key={bank.id} value={String(bank.id)}>
                {bank.name}
                {bank.isDefault ? ' (default)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!isCreating ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => setIsCreating(true)}
        >
          <IconPlus className="h-4 w-4 mr-1" />
          New bank
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            aria-label="New bank name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Bank name"
            className="w-48"
            disabled={isSaving}
          />
          <Button type="button" size="sm" onClick={handleCreate} disabled={isSaving || !newName.trim()}>
            Create
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsCreating(false);
              setNewName('');
            }}
            disabled={isSaving}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
};

export { ALL_QUESTIONS_VALUE };
