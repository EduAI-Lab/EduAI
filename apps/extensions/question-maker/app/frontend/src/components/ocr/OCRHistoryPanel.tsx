import { useMemo, useState } from 'react';
import { History, Trash2, X, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Tooltip } from '../ui/tooltip';
import { OCRJobCard } from './OCRJobCard';
import type { OCRJob } from '../../types/ocr';

function isToday(d: Date): boolean {
  const today = new Date();
  return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
}

function isYesterday(d: Date): boolean {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear();
}

interface GroupedJobs {
  inProgress: OCRJob[];
  today: OCRJob[];
  yesterday: OCRJob[];
  earlier: OCRJob[];
}

function groupJobsByDate(jobs: OCRJob[]): GroupedJobs {
  const groups: GroupedJobs = { inProgress: [], today: [], yesterday: [], earlier: [] };
  for (const job of jobs) {
    if (job.status === 'pending' || job.status === 'processing') {
      groups.inProgress.push(job);
      continue;
    }
    const date = new Date(job.createdAt);
    if (isToday(date)) groups.today.push(job);
    else if (isYesterday(date)) groups.yesterday.push(job);
    else groups.earlier.push(job);
  }
  return groups;
}

interface JobGroupProps {
  title: string;
  jobs: OCRJob[];
  currentCourseId: number;
  onSelectJob: (job: OCRJob) => void;
  onRemoveJob: (jobId: string) => void;
  defaultOpen?: boolean;
}

function JobGroup({
  title,
  jobs,
  currentCourseId,
  onSelectJob,
  onRemoveJob,
  defaultOpen = true,
}: JobGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  if (jobs.length === 0) return null;
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {title}
        <span className="ml-auto text-[10px] font-normal">({jobs.length})</span>
      </button>
      {open && (
        <div className="space-y-2">
          {jobs.map((job) => (
            <OCRJobCard
              key={job.id}
              job={job}
              isCurrentCourse={job.courseId === currentCourseId}
              onSelect={onSelectJob}
              onRemove={onRemoveJob}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface OCRHistoryPanelProps {
  jobs: OCRJob[];
  currentCourseId: number;
  isOpen: boolean;
  onToggle: () => void;
  onSelectJob: (job: OCRJob) => void;
  onRemoveJob: (jobId: string) => void;
  onClearHistory: () => void;
}

export function OCRHistoryPanel({
  jobs,
  currentCourseId,
  isOpen,
  onToggle,
  onSelectJob,
  onRemoveJob,
  onClearHistory,
}: OCRHistoryPanelProps) {
  const groupedJobs = useMemo(() => groupJobsByDate(jobs), [jobs]);
  const hasJobs = jobs.length > 0;
  const inProgressCount = groupedJobs.inProgress.length;

  return (
    <div
      className={cn(
        'flex flex-col border-l bg-muted/30 transition-all duration-200',
        isOpen ? 'w-72' : 'w-0 overflow-hidden border-l-0'
      )}
    >
      {isOpen && (
        <>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <History className="size-4" />
              <h3 className="text-sm font-medium">Upload History</h3>
              {inProgressCount > 0 && (
                <span className="flex size-5 items-center justify-center rounded-full bg-blue-500 text-[10px] font-medium text-white">
                  {inProgressCount}
                </span>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={onToggle} aria-label="Close history panel">
              <X className="size-4" />
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              {!hasJobs ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <History className="size-10 text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">No recent uploads</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Your OCR upload history will appear here
                  </p>
                </div>
              ) : (
                <>
                  <JobGroup
                    title="In Progress"
                    jobs={groupedJobs.inProgress}
                    currentCourseId={currentCourseId}
                    onSelectJob={onSelectJob}
                    onRemoveJob={onRemoveJob}
                  />
                  <JobGroup
                    title="Today"
                    jobs={groupedJobs.today}
                    currentCourseId={currentCourseId}
                    onSelectJob={onSelectJob}
                    onRemoveJob={onRemoveJob}
                  />
                  <JobGroup
                    title="Yesterday"
                    jobs={groupedJobs.yesterday}
                    currentCourseId={currentCourseId}
                    onSelectJob={onSelectJob}
                    onRemoveJob={onRemoveJob}
                  />
                  <JobGroup
                    title="Earlier"
                    jobs={groupedJobs.earlier}
                    currentCourseId={currentCourseId}
                    onSelectJob={onSelectJob}
                    onRemoveJob={onRemoveJob}
                    defaultOpen={false}
                  />
                </>
              )}
            </div>
          </ScrollArea>

          {hasJobs && (
            <div className="border-t p-3">
              <Tooltip content="Remove all jobs from the list. Does not affect questions you already saved." side="top" className="block w-full">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground hover:text-destructive"
                  onClick={onClearHistory}
                >
                  <Trash2 className="size-3.5 mr-1.5" />
                  Clear History
                </Button>
              </Tooltip>
            </div>
          )}
        </>
      )}
    </div>
  );
}
