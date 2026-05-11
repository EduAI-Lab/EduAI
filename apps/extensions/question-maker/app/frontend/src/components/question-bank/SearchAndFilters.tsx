/**
 * Search and sort controls for the question bank panel.
 * Provides a text filter and filter dropdowns that feed parent callbacks.
 */
import { useEffect, useRef, useState } from 'react';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { ChevronDown, X } from 'lucide-react';
import { QuestionType, QuestionDifficulty, ReasoningLevel } from '../../types/question';

export interface QuestionFilters {
  questionTypes: QuestionType[];
  reasoningLevels: ReasoningLevel[];
  difficulties: QuestionDifficulty[];
  aiGenerated: 'all' | 'ai' | 'not-ai';
  draftStatus: 'all' | 'draft' | 'reviewed';
}

interface SearchAndFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  filters: QuestionFilters;
  onFiltersChange: (filters: QuestionFilters) => void;
}

// Multi-select dropdown component for string values
interface MultiSelectProps {
  placeholder: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  displayValue?: (value: string) => string;
}

const MultiSelect = ({ placeholder, options, selected, onChange, displayValue }: MultiSelectProps) => {
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

  const toggleOption = (option: string) => {
    onChange(
      selected.includes(option)
        ? selected.filter((value) => value !== option)
        : [...selected, option]
    );
  };

  const displayText = selected.length > 0 
    ? `${selected.length} selected` 
    : placeholder;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <span className="truncate">{displayText}</span>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </button>
      {isOpen && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md">
          <div className="max-h-56 overflow-y-auto p-1">
            {options.map((option) => (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => toggleOption(option)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm">{displayValue ? displayValue(option) : option}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <div className="border-t px-2 py-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange([])}
                className="h-7 w-full text-xs"
              >
                Clear
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const SearchAndFilters = ({
  searchTerm,
  onSearchChange,
  filters,
  onFiltersChange
}: SearchAndFiltersProps) => {
  const hasActiveFilters = 
    filters.questionTypes.length > 0 ||
    filters.reasoningLevels.length > 0 ||
    filters.difficulties.length > 0 ||
    filters.aiGenerated !== 'all' ||
    filters.draftStatus !== 'all';

  const clearFilters = () => {
    onFiltersChange({
      questionTypes: [],
      reasoningLevels: [],
      difficulties: [],
      aiGenerated: 'all',
      draftStatus: 'all'
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Search & Filters</CardTitle>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="flex items-center gap-1">
              <X className="h-4 w-4" />
              Clear Filters
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 items-end">
          {/* Search Input - takes less space */}
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Search</label>
            <Input
              placeholder="Search questions..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>

          {/* Question Types Multi-Select */}
          <div className="w-[140px]">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Question Types</label>
            <MultiSelect
              placeholder="All"
              options={['MCQ', 'SA', 'LA']}
              selected={filters.questionTypes}
              onChange={(selected) => onFiltersChange({ ...filters, questionTypes: selected as QuestionType[] })}
            />
          </div>

          {/* Reasoning Level Multi-Select */}
          <div className="w-[160px]">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Reasoning Level</label>
            <MultiSelect
              placeholder="All"
              options={['factual', 'analytical', 'application']}
              selected={filters.reasoningLevels}
              onChange={(selected) => onFiltersChange({ ...filters, reasoningLevels: selected as ReasoningLevel[] })}
              displayValue={(value) => value.charAt(0).toUpperCase() + value.slice(1)}
            />
          </div>

          {/* Difficulty Multi-Select */}
          <div className="w-[130px]">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Difficulty</label>
            <MultiSelect
              placeholder="All"
              options={['easy', 'medium', 'hard']}
              selected={filters.difficulties}
              onChange={(selected) => onFiltersChange({ ...filters, difficulties: selected as QuestionDifficulty[] })}
              displayValue={(value) => value.charAt(0).toUpperCase() + value.slice(1)}
            />
          </div>

          {/* AI Generated Dropdown */}
          <div className="w-[150px]">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">AI Generated</label>
            <Select
              value={filters.aiGenerated}
              onValueChange={(value) => onFiltersChange({ ...filters, aiGenerated: value as 'all' | 'ai' | 'not-ai' })}
            >
              <SelectTrigger>
                <SelectValue placeholder="AI Generated" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="ai">AI Generated</SelectItem>
                <SelectItem value="not-ai">Not AI Generated</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Draft Status Dropdown */}
          <div className="w-[130px]">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Review  Status</label>
            <Select
              value={filters.draftStatus}
              onValueChange={(value) => onFiltersChange({ ...filters, draftStatus: value as 'all' | 'draft' | 'reviewed' })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
