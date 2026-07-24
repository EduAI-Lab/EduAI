/**
 * @file Sortable — drag-and-drop reordering primitives built on @dnd-kit,
 * shared across apps (module/lesson grids, activity lists, and any future
 * reorderable surface).
 *
 * Reordering is handle-driven: each item exposes a `DragHandle` (the classic
 * six-dot grip) as the only drag activator, so the rest of the card stays a
 * normal click/keyboard target (e.g. navigate-to-module). The same primitives
 * serve both card grids and vertical lists — only the `strategy` differs.
 *
 * `SortableProvider` owns the DnD context and translates a drop into a single
 * `onReorder(orderedIds)` call with the full new order; persistence and
 * optimistic update are the caller's job. When `disabled`, the context stays
 * mounted (so `SortableItem`'s `useSortable` always has a provider — callers
 * flip `disabled` mid-request while reordering) but dragging is switched off
 * via `useSortable({ disabled })` and a guarded drag-end handler.
 */
import * as React from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToParentElement } from "@dnd-kit/modifiers"
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { IconGripVertical } from "@tabler/icons-react"
import { cn } from "./utils"

export interface SortableProviderProps {
  /** Item ids in their current display order. */
  ids: number[]
  /** Called with the full new order after a successful drop. */
  onReorder: (orderedIds: number[]) => void
  /** Grids use rect strategy; vertical lists use list strategy. */
  strategy?: "grid" | "list"
  /** When true, dragging is disabled (the context stays mounted). */
  disabled?: boolean
  children: React.ReactNode
}

/**
 * Lets `SortableItem` inherit the provider's `disabled` state so the DnD
 * context can stay mounted while dragging is off (e.g. during a persist
 * request) without every caller having to thread `disabled` down twice.
 */
const SortableDisabledContext = React.createContext(false)

export function SortableProvider({
  ids,
  onReorder,
  strategy = "grid",
  disabled = false,
  children,
}: SortableProviderProps) {
  // Require a small drag distance before a pointer-down becomes a drag so the
  // grip still supports plain clicks/taps without triggering a reorder.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (disabled || !over || active.id === over.id) return
    const oldIndex = ids.indexOf(Number(active.id))
    const newIndex = ids.indexOf(Number(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    onReorder(arrayMove(ids, oldIndex, newIndex))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToParentElement]}
    >
      <SortableContext
        items={ids}
        strategy={strategy === "list" ? verticalListSortingStrategy : rectSortingStrategy}
      >
        <SortableDisabledContext.Provider value={disabled}>
          {children}
        </SortableDisabledContext.Provider>
      </SortableContext>
    </DndContext>
  )
}

export interface SortableItemProps {
  id: number
  disabled?: boolean
  className?: string
  /**
   * Render prop for the item body. Spread `handleProps` onto the `DragHandle`
   * so only the handle initiates a drag; `isDragging` lets the body reflect the
   * active state.
   */
  children: (args: {
    handleProps: Record<string, unknown>
    isDragging: boolean
  }) => React.ReactNode
}

export function SortableItem({ id, disabled = false, className, children }: SortableItemProps) {
  const providerDisabled = React.useContext(SortableDisabledContext)
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id,
    disabled: disabled || providerDisabled,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className={className}>
      {children({ handleProps: { ...attributes, ...listeners }, isDragging })}
    </div>
  )
}

export interface DragHandleProps {
  /** The dnd-kit attributes + listeners from `SortableItem`'s render prop. */
  handleProps: Record<string, unknown>
  /** Screen-reader label, e.g. "Drag to reorder module". */
  label?: string
  className?: string
}

/**
 * Wrap one of dnd-kit's event listeners so it still runs, but the event never
 * reaches an interactive ancestor. Cards that wrap a handle are usually
 * clickable *and* keyboard-activatable, so Enter/Space on the grip must start a
 * drag without also firing the card's navigation handler.
 */
function isolate<E extends React.SyntheticEvent>(
  handler: unknown,
): (event: E) => void {
  return (event: E) => {
    if (typeof handler === "function") (handler as (e: E) => void)(event)
    event.stopPropagation()
  }
}

export function DragHandle({ handleProps, label = "Drag to reorder", className }: DragHandleProps) {
  const { onClick, onKeyDown, onKeyUp, ...rest } = handleProps as {
    onClick?: unknown
    onKeyDown?: unknown
    onKeyUp?: unknown
  } & Record<string, unknown>

  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md " +
          "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
        className,
      )}
      {...rest}
      // Composed last so dnd-kit's own handlers still run, but neither a click
      // nor a key activation bubbles into a clickable parent card.
      onClick={isolate<React.MouseEvent>(onClick)}
      onKeyDown={isolate<React.KeyboardEvent>(onKeyDown)}
      onKeyUp={isolate<React.KeyboardEvent>(onKeyUp)}
    >
      <IconGripVertical size={16} aria-hidden="true" />
    </button>
  )
}
