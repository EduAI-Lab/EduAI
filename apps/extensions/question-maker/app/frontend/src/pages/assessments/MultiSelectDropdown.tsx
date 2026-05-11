/**
 * Lightweight multi-select dropdown for topics with outside-click handling.
 * Allows toggling selections while honoring disabled IDs.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Topic } from '../../types/topic';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';

interface MultiSelectDropdownProps {
  label: string;
  options: Topic[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  disabledIds?: Set<number>;
  /** Optional: match filter panel style (e.g. primary topic dropdown) */
  labelClassName?: string;
  triggerClassName?: string;
  listClassName?: string;
}

export const MultiSelectDropdown = ({
  label,
  options,
  selectedIds,
  onChange,
  disabledIds = new Set<number>(),
  labelClassName,
  triggerClassName,
  listClassName
}: MultiSelectDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOption = (id: number) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((value) => value !== id)
        : [...selectedIds, id]
    );
  };

  const selectedNames = options
    .filter((topic) => selectedIds.includes(topic.id))
    .map((topic) => topic.name);

  return (
    <div className="space-y-1" ref={containerRef}>
      <Label className={labelClassName ?? 'text-xs uppercase text-muted-foreground'}>{label}</Label>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={
          triggerClassName ??
          'flex w-full items-center justify-between rounded border border-gray-300 bg-white px-3 py-2 text-left text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary'
        }
      >
        <span>
          {selectedNames.length > 0 ? `${selectedNames.length} selected` : 'Select topics'}
        </span>
        <ChevronDown className="h-4 w-4 opacity-60" />
      </button>
      {isOpen && (
        <div className={listClassName ?? 'z-20 mt-1 max-h-56 w-full rounded border border-gray-200 bg-white shadow-lg'}>
          <div className="max-h-56 overflow-y-auto text-sm">
            {options.length === 0 && (
              <div className="px-3 py-2 text-muted-foreground">No topics available</div>
            )}
            {options.map((topic) => (
              <label
                key={topic.id}
                className={`flex items-center gap-2 px-3 py-2 ${
                  disabledIds.has(topic.id)
                    ? 'cursor-not-allowed text-muted-foreground'
                    : 'cursor-pointer hover:bg-secondary/50'
                }`}
              >
                <input
                  type="checkbox"
                  disabled={disabledIds.has(topic.id)}
                  checked={selectedIds.includes(topic.id)}
                  onChange={() => toggleOption(topic.id)}
                  className="rounded border-gray-300"
                />
                <span>{topic.name}</span>
              </label>
            ))}
          </div>
          <div className="border-t px-3 py-2 text-right">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange([])}
              className="text-xs text-muted-foreground"
            >
              Clear
            </Button>
          </div>
        </div>
      )}
      {selectedNames.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Selected: {selectedNames.join(', ')}
        </p>
      )}
    </div>
  );
};
