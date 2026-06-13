import { Input } from '@eduai/ui'
import { Label } from '@eduai/ui'
import {
  IconAlertCircle,
  IconCircleCheck,
  IconLoader,
} from '@tabler/icons-react'
import { Alert, AlertDescription } from '@eduai/ui'

export interface CourseMaterial {
  id: string
  title: string
  mimeType: string
  fileSize: number
  status: 'PROCESSING' | 'READY' | 'FAILED'
  createdAt: string
  chunks?: Array<{ id: string; content: string }>
}

export interface CourseMaterialsUploadProps {
  isUploading?: boolean
  error?: string | null
  success?: string | null
  onFileSelect: (file: File) => void
}

// ── component ─────────────────────────────────────────────────────────────────

export function CourseMaterialsUpload({
  isUploading = false,
  error = null,
  success = null,
  onFileSelect,
}: CourseMaterialsUploadProps) {
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onFileSelect(file)
    event.target.value = ''
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="file-upload">Select file</Label>
        <p className="text-[12px] text-muted-foreground mt-0.5 mb-2">
          Supported formats: PDF, DOCX, PPTX, TXT, MD
        </p>
        <Input
          id="file-upload"
          type="file"
          accept=".pdf,.docx,.pptx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown"
          onChange={handleFileChange}
          disabled={isUploading}
          className="mt-1"
        />
      </div>

      {isUploading && (
        <Alert>
          <IconLoader className="h-4 w-4 animate-spin" />
          <AlertDescription>Uploading and processing material…</AlertDescription>
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
