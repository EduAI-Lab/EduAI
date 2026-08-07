import { useRef, useState } from 'react'
import { Spinner } from '@eduai/ui';
import { cn } from '@eduai/ui'
import { Alert, AlertDescription } from '@eduai/ui'
import {
  IconUpload,
  IconFile,
  IconAlertCircle,
  IconCircleCheck,
  IconX,
} from '@tabler/icons-react'

export interface CourseMaterial {
  id: string
  title: string
  mimeType: string
  fileSize: number
  status: 'PROCESSING' | 'READY' | 'FAILED'
  createdAt: string
  chunkCount?: number
  /** Owner FK — used to gate TA own-only delete (§7). */
  uploadedBy?: string | null
  /**
   * Student-visibility gate (staff-only field; omitted from student responses).
   * false = hidden from students even in a published course.
   */
  visibleToStudents?: boolean
  /**
   * Scheduled reveal timestamp (ISO string) or null. When set in the future,
   * students don't see the material until it passes. Staff-only field.
   */
  availableAt?: string | null
  chunks?: Array<{ id: string; content: string }>
}

export interface CourseMaterialsUploadProps {
  isUploading?: boolean
  error?: string | null
  success?: string | null
  onFileSelect: (file: File) => void
}

const ACCEPTED =
  '.pdf,.docx,.pptx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown'

// ── component ─────────────────────────────────────────────────────────────────

export function CourseMaterialsUpload({
  isUploading = false,
  error = null,
  success = null,
  onFileSelect,
}: CourseMaterialsUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const triggerPick = () => {
    if (!isUploading) inputRef.current?.click()
  }

  const processFile = (file: File) => {
    setSelectedFile(file)
    onFileSelect(file)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (isUploading) return
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (!isUploading) setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false)
  }

  const clearFile = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedFile(null)
  }

  const showFile = selectedFile && !isUploading && !success && !error

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={isUploading ? -1 : 0}
        aria-disabled={isUploading}
        onClick={triggerPick}
        onKeyDown={(e) => e.key === 'Enter' && triggerPick()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-[var(--radius-xl)]',
          'border-2 border-dashed border-border py-9 px-6 outline-none',
          'transition-colors duration-150 select-none',
          isDragging && 'border-primary bg-primary/5',
          isUploading
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-pointer hover:border-primary/50 hover:bg-muted/30 focus-visible:border-ring focus-visible:shadow-[var(--shadow-focus)]',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          onChange={handleFileChange}
          disabled={isUploading}
          className="sr-only"
          tabIndex={-1}
        />

        <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-lg)] bg-primary/10">
          <IconUpload className="h-5 w-5 text-primary-text" />
        </div>

        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            Drag & drop or{' '}
            <span className="text-primary-text underline-offset-2 hover:underline">browse files</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">PDF, DOCX, PPTX, TXT, MD</p>
        </div>
      </div>

      {/* Selected file pill (brief flash before upload state takes over) */}
      {showFile && (
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-muted/30 px-3 py-2">
          <IconFile className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate text-sm text-foreground">{selectedFile.name}</span>
          <button
            type="button"
            aria-label="Clear selection"
            onClick={clearFile}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Upload states */}
      {isUploading && (
        <Alert>
          <Spinner />
          <AlertDescription>
            Uploading{selectedFile ? ` "${selectedFile.name}"` : ''}…
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <IconAlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <IconCircleCheck className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
