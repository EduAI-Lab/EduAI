/**
 * CourseChatHistory — read-only chat history stub for course detail pages.
 *
 * The Chat DB model (@@map "chats") does not yet carry a courseId column, so
 * per-course filtering is not possible without a backend schema change.  This
 * component shows an informative empty state pointing users to the global
 * chatbot while keeping a clear hook surface so the list can be wired up once
 * #XXXX lands.  No endpoints are fabricated.
 */
import { IconMessageCircle } from '@tabler/icons-react'
import { Link } from 'react-router'

interface CourseChatHistoryProps {
  courseCode: string
}

export function CourseChatHistory({ courseCode }: CourseChatHistoryProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div
        className="w-14 h-14 rounded-[14px] flex items-center justify-center mb-4"
        style={{ background: 'var(--muted)' }}
      >
        <IconMessageCircle size={26} className="text-muted-foreground" stroke={1.5} />
      </div>
      <h2 className="text-[15px] font-semibold text-foreground mb-2">
        Course chat history
      </h2>
      <p className="text-[13px] text-muted-foreground max-w-sm leading-relaxed mb-6">
        Per-course conversation history is coming soon. In the meantime, use
        the main chatbot and select <span className="font-medium">{courseCode}</span> from
        the course selector to scope your questions to this course.
      </p>
      <Link
        to="/chat"
        className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-white rounded-[var(--radius-lg)] transition-opacity hover:opacity-90"
        style={{ background: 'oklch(0.192 0.055 259)' }}
      >
        Go to chatbot
      </Link>
    </div>
  )
}
