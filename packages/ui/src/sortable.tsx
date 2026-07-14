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
 * optimistic update are the caller's job. When `disabled`, it renders children
 * untouched (no context, no handles active) so non-editors get plain cards.
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
  /** When true, renders children without any DnD wiring. */
  disabled?: boolean
  children: React.ReactNode
}

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

  if (disabled) return <>{children}</>

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
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
        {children}
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
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id,
    disabled,
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
  /**
   * `"button"` (default) — a compact standalone grip button.
   * `"bar"` — a full-height rail pinned to the parent's left edge that widens
   * on hover and widens further while `active`. The parent must be
   * `position: relative` (e.g. `SortableItem` with `className="relative"`).
   */
  variant?: "button" | "bar"
  /** When the item is being dragged, the bar expands further. */
  active?: boolean
}

export function DragHandle({
  handleProps,
  label = "Drag to reorder",
  className,
  variant = "button",
  active = false,
}: DragHandleProps) {
  // Keep a click on the handle from bubbling to a clickable parent card.
  const stopClick = (event: { stopPropagation: () => void }) => event.stopPropagation()

  if (variant === "bar") {
    return (
      <button
        type="button"
        aria-label={label}
        onClick={stopClick}
        className={cn(
          "group/handle absolute inset-y-0 left-0 z-20 flex touch-none cursor-grab items-center " +
            "justify-center overflow-hidden rounded-l-[var(--radius-lg)] border-r border-border/60 " +
            "text-muted-foreground transition-[width,background-color] duration-150 " +
            "hover:bg-muted hover:text-foreground focus-visible:outline-none " +
            "focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
          active ? "w-7 bg-muted text-foreground" : "w-2 bg-muted/50 hover:w-6",
          className,
        )}
        {...handleProps}
      >
        <IconGripVertical
          size={14}
          aria-hidden="true"
          className={cn(
            "shrink-0 transition-opacity duration-150",
            active ? "opacity-100" : "opacity-0 group-hover/handle:opacity-100",
          )}
        />
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={stopClick}
      className={cn(
        "flex size-7 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground " +
          "transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none " +
          "focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
        className,
      )}
      {...handleProps}
    >
      <IconGripVertical size={16} aria-hidden="true" />
    </button>
  )
}
