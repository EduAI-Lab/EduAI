/**
 * @file Shared course-hero topic control — sync/create topics from the hero banner.
 *
 * Plugs into `CourseHeroCard`'s `topicsAction` slot. Purely presentational: all
 * data operations (fetching, syncing, creating, permission checks, toasts) are
 * injected by the host app via props. Two host apps consume this:
 *   - question-maker: has a Core sync endpoint, uses a toast system.
 *   - ai-tutor: has NO sync endpoint (Core-linked courses auto-pull topics
 *     server-side, see #1031) and shows errors inline in the dialog instead.
 *
 * Behavior:
 *   - Renders nothing when `canManage` is false.
 *   - When `isLinked` is true and `onSync` is provided, renders a sync button
 *     (optionally tooltipped via `syncTooltip`).
 *   - When `isLinked` is true and `onSync` is NOT provided, renders nothing —
 *     the host has no sync affordance for linked courses (ai-tutor case).
 *   - Otherwise renders a "Create topic" button that opens a create dialog.
 */
import { useState } from "react"
import { IconLoader2, IconPlus, IconRefresh } from "@tabler/icons-react"
import { Button } from "./ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"
import { Input } from "./ui/input"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip"

const HERO_BUTTON_CLASS =
  "border-white/30 bg-white/15 text-white hover:bg-white/25 hover:text-white backdrop-blur-sm"

export interface CourseTopicsHeroActionProps {
  /** Renders nothing when false — caller has no manage permission for topics. */
  canManage: boolean
  /** True when the course is linked to an EduAI Core course (sync-eligible). */
  isLinked: boolean
  /**
   * Sync handler. When provided and `isLinked`, a sync button renders instead
   * of the create-topic affordance. Omit entirely when the host app has no
   * sync endpoint (e.g. ai-tutor) — linked courses then render nothing.
   */
  onSync?: () => Promise<void>
  /** Controlled syncing/loading state (host owns the async call). */
  isSyncing?: boolean
  /** Tooltip text for the sync button; omit both tooltip props to render without a tooltip. */
  syncTooltip?: string
  /** Tooltip text for the create-topic button; omit both tooltip props to render without a tooltip. */
  createTooltip?: string
  /** Create-topic handler. Throw/reject to signal failure. */
  onCreateTopic: (name: string) => Promise<void>
  /** Copy for the create dialog description. */
  createDialogDescription?: string
  /** Show a generic inline error line in the create dialog on failure. */
  showInlineCreateError?: boolean
  /** Called after a successful create (dialog is already closed/reset). */
  onCreateSuccess?: (name: string) => void
  /** Called after a failed create, in addition to any inline error text. */
  onCreateError?: (error: unknown) => void
  /**
   * Called when the user submits an empty topic name, in addition to any
   * inline error text. Message is "Topic name cannot be empty."
   */
  onCreateValidationError?: (message: string) => void
}

export function CourseTopicsHeroAction({
  canManage,
  isLinked,
  onSync,
  isSyncing = false,
  syncTooltip,
  createTooltip,
  onCreateTopic,
  createDialogDescription = "Add a new topic to organize this course's content.",
  showInlineCreateError = true,
  onCreateSuccess,
  onCreateError,
  onCreateValidationError,
}: CourseTopicsHeroActionProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [newTopicName, setNewTopicName] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  if (!canManage) return null
  if (isLinked && !onSync) return null

  const closeAndResetDialog = (open: boolean) => {
    if (creating) return
    setCreateOpen(open)
    if (!open) {
      setNewTopicName("")
      setCreateError(null)
    }
  }

  const handleCreateTopic = async () => {
    const name = newTopicName.trim()
    if (!name) {
      const message = "Topic name cannot be empty."
      if (showInlineCreateError) {
        setCreateError(message)
      }
      onCreateValidationError?.(message)
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      await onCreateTopic(name)
      setNewTopicName("")
      setCreateOpen(false)
      onCreateSuccess?.(name)
    } catch (error) {
      if (showInlineCreateError) {
        setCreateError("Could not create topic. Try a different name.")
      }
      onCreateError?.(error)
    } finally {
      setCreating(false)
    }
  }

  const button =
    isLinked && onSync ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={HERO_BUTTON_CLASS}
        onClick={() => void onSync()}
        disabled={isSyncing}
        aria-label="Sync topics from EduAI"
      >
        <IconRefresh className={`size-4${isSyncing ? " animate-spin" : ""}`} aria-hidden="true" />
        {isSyncing ? "Syncing…" : "Sync now"}
      </Button>
    ) : (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={HERO_BUTTON_CLASS}
        onClick={() => setCreateOpen(true)}
        aria-label="Create topic"
      >
        <IconPlus className="size-4" aria-hidden="true" />
        Create topic
      </Button>
    )

  const isSyncButton = isLinked && !!onSync
  const tooltip = isSyncButton ? syncTooltip : createTooltip

  return (
    <>
      {tooltip ? (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        button
      )}

      <Dialog open={createOpen} onOpenChange={closeAndResetDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Topic</DialogTitle>
            <DialogDescription>{createDialogDescription}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              placeholder="Topic name"
              value={newTopicName}
              onChange={(e) => setNewTopicName(e.target.value)}
              autoFocus
            />
            <Button onClick={() => void handleCreateTopic()} disabled={creating} className="shrink-0">
              {creating && <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />}
              Create
            </Button>
          </div>
          {createError && <p className="text-sm text-destructive">{createError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
