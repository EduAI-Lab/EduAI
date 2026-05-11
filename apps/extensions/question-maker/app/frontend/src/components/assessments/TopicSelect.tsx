/**
 * Drag-free topic selector that manages primary, secondary, and excluded topic lists.
 * Filters available topics, supports search, and emits changes per category.
 */
import * as React from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { X } from 'lucide-react';
import { Tooltip } from '../ui/tooltip';

type Topic = { id: number; name: string };
type TopicCategory = 'general' | 'primary' | 'secondary' | 'excluded';

interface TopicSelectProps {
  availableTopics: Topic[];
  primaryTopicIds: number[];
  secondaryTopicIds: number[];
  excludedTopicIds: number[];
  onPrimaryChange: (ids: number[]) => void;
  onSecondaryChange: (ids: number[]) => void;
  onExcludedChange: (ids: number[]) => void;
}

export const TopicSelect = ({
  availableTopics,
  primaryTopicIds,
  secondaryTopicIds,
  excludedTopicIds,
  onPrimaryChange,
  onSecondaryChange,
  onExcludedChange,
}: TopicSelectProps) => {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedTopicIds, setSelectedTopicIds] = React.useState<Set<number>>(new Set());
  const [flashCategory, setFlashCategory] = React.useState<TopicCategory | null>(null);
  const [hoverCategory, setHoverCategory] = React.useState<TopicCategory | null>(null);

  // Get topics in each category
  const getTopicsByCategory = (category: TopicCategory): Topic[] => {
    const ids = category === 'primary' ? primaryTopicIds : category === 'secondary' ? secondaryTopicIds : category === 'excluded' ? excludedTopicIds : [];
    return availableTopics.filter(t => ids.includes(t.id));
  };

  // Get general bank topics (not in any category)
  const generalBankTopics = React.useMemo(() => {
    const categorizedIds = new Set([...primaryTopicIds, ...secondaryTopicIds, ...excludedTopicIds]);
    let filtered = availableTopics.filter(t => !categorizedIds.has(t.id));
    
    // Apply search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter(t => 
        t.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    return filtered;
  }, [availableTopics, primaryTopicIds, secondaryTopicIds, excludedTopicIds, searchQuery]);

  // Handle topic selection toggle
  const toggleTopicSelection = (topicId: number) => {
    setSelectedTopicIds(prev => {
      const next = new Set(prev);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
      }
      return next;
    });
  };

  // Assign selected topics to a category
  const assignToCategory = (targetCategory: TopicCategory) => {
    if (selectedTopicIds.size === 0) return;

    const selectedArray = Array.from(selectedTopicIds);

    // Remove from all categories first
    const newPrimary = primaryTopicIds.filter(id => !selectedArray.includes(id));
    const newSecondary = secondaryTopicIds.filter(id => !selectedArray.includes(id));
    const newExcluded = excludedTopicIds.filter(id => !selectedArray.includes(id));

    // Add to target category
    if (targetCategory === 'primary') {
      onPrimaryChange([...newPrimary, ...selectedArray]);
      onSecondaryChange(newSecondary);
      onExcludedChange(newExcluded);
    } else if (targetCategory === 'secondary') {
      onSecondaryChange([...newSecondary, ...selectedArray]);
      onPrimaryChange(newPrimary);
      onExcludedChange(newExcluded);
    } else if (targetCategory === 'excluded') {
      onExcludedChange([...newExcluded, ...selectedArray]);
      onPrimaryChange(newPrimary);
      onSecondaryChange(newSecondary);
    } else {
      // Returning to general - just remove from all categories
      onPrimaryChange(newPrimary);
      onSecondaryChange(newSecondary);
      onExcludedChange(newExcluded);
    }

    // Flash animation
    setFlashCategory(targetCategory);
    setTimeout(() => setFlashCategory(null), 500);

    // Clear selection
    setSelectedTopicIds(new Set());
  };

  // Handle remove from category (return to general bank)
  const handleRemove = (topicId: number, category: TopicCategory) => {
    if (category === 'primary') {
      onPrimaryChange(primaryTopicIds.filter(i => i !== topicId));
    } else if (category === 'secondary') {
      onSecondaryChange(secondaryTopicIds.filter(i => i !== topicId));
    } else if (category === 'excluded') {
      onExcludedChange(excludedTopicIds.filter(i => i !== topicId));
    }
  };

  // Pill component
  const TopicPill = ({ topic, category, isSelected = false }: { topic: Topic; category: TopicCategory; isSelected?: boolean }) => {
    const [showRemove, setShowRemove] = React.useState(false);

    const colorClasses = {
      general: isSelected 
        ? 'bg-blue-50 text-blue-700 border-2 border-blue-500 shadow-md' 
        : 'bg-white text-gray-800 border border-gray-300 hover:shadow-md',
      primary: 'bg-blue-500 text-white border-blue-600',
      secondary: 'bg-orange-500 text-white border-orange-600',
      excluded: 'bg-red-500 text-white border-red-600',
    };

    return (
      <div
        onClick={() => category === 'general' && toggleTopicSelection(topic.id)}
        onMouseEnter={() => setShowRemove(true)}
        onMouseLeave={() => setShowRemove(false)}
        className={`
          relative inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border
          transition-all select-none
          ${colorClasses[category]}
          ${category === 'general' ? 'cursor-pointer hover:scale-105' : ''}
        `}
      >
        <span className="flex-1">{topic.name}</span>
        {showRemove && category !== 'general' && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRemove(topic.id, category);
            }}
            className="ml-1 p-0.5 rounded-full hover:bg-black/20 transition-colors"
            aria-label={`Remove ${topic.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  };

  // Category zone component
  const CategoryZone = ({ 
    category, 
    label, 
    required = false 
  }: { 
    category: TopicCategory; 
    label: string; 
    required?: boolean;
  }) => {
    const topics = getTopicsByCategory(category);
    const isFlashing = flashCategory === category;
    const isHovered = hoverCategory === category && selectedTopicIds.size > 0;
    const hasSelection = selectedTopicIds.size > 0;

    const categoryStyles = {
      primary: {
        border: isHovered || isFlashing ? 'border-blue-400 bg-blue-50/50' : 'border-gray-300 bg-gray-50/50',
        glow: 'ring-2 ring-blue-300',
      },
      secondary: {
        border: isHovered || isFlashing ? 'border-orange-400 bg-orange-50/50' : 'border-gray-300 bg-gray-50/50',
        glow: 'ring-2 ring-orange-300',
      },
      excluded: {
        border: isHovered || isFlashing ? 'border-red-400 bg-red-50/50' : 'border-gray-300 bg-gray-50/50',
        glow: 'ring-2 ring-red-300',
      },
    };

    const tooltipContent = {
      primary: 'Focus of the assessment.',
      secondary: 'Minor focus of the assessment.',
      excluded: 'Topics to avoid completely.',
    };

    const styles = categoryStyles[category] || categoryStyles.primary;

    return (
      <div
        onMouseEnter={() => setHoverCategory(category)}
        onMouseLeave={() => setHoverCategory(null)}
        onClick={() => hasSelection && assignToCategory(category)}
        className={`
          min-h-[120px] p-4 rounded-lg border-2 border-dashed transition-all
          ${styles.border}
          ${isFlashing ? `${styles.glow} animate-pulse` : ''}
          ${isHovered ? `${styles.glow} cursor-pointer` : hasSelection ? 'cursor-pointer' : 'cursor-default'}
        `}
      >
        <div className="mb-2">
          <Tooltip content={tooltipContent[category]} side="top">
            <Label className="text-sm font-semibold cursor-help inline-block">
              {label}
              {required && <span className="text-red-500 ml-1">*</span>}
            </Label>
          </Tooltip>
        </div>
        {topics.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-4">
            {hasSelection ? 'Click to assign selected topics' : '+ Click to assign topics here'}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {topics.map(topic => (
              <TopicPill key={topic.id} topic={topic} category={category} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: General Topic Bank */}
        <div className="space-y-3">
          <div>
            <Label className="text-base font-semibold mb-2 block">General Topic Bank</Label>
            <Input
              placeholder="Search topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full"
            />
          </div>

          {selectedTopicIds.size > 0 && (
            <div className="text-sm text-blue-600 font-medium">
              {selectedTopicIds.size} topic{selectedTopicIds.size !== 1 ? 's' : ''} selected — Click a category zone to assign
            </div>
          )}

          <div className="min-h-[200px] max-h-[300px] overflow-y-auto p-3 border rounded-lg bg-gray-50">
            {generalBankTopics.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">
                {searchQuery ? 'No topics found' : 'No topics available'}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {generalBankTopics.map(topic => (
                  <TopicPill 
                    key={topic.id} 
                    topic={topic} 
                    category="general" 
                    isSelected={selectedTopicIds.has(topic.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Categories */}
        <div className="space-y-4">
          <CategoryZone category="primary" label="Primary Topics" required />
          <CategoryZone category="secondary" label="Secondary Topics" />
          <CategoryZone category="excluded" label="Excluded Topics" />
        </div>
      </div>

      {/* Validation Message */}
      {primaryTopicIds.length === 0 && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
          ⚠️ Please add at least one Primary Topic before generating an assessment.
        </div>
      )}
    </div>
  );
};
