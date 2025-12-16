import { IconEdit, IconPlus, IconTrash } from "@tabler/icons-react"

import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { CategoryRow } from "~/components/ui/CategoryRow";
import type { CourseCategory, Topic } from "~/types/course";

type Props = {
  categories: CourseCategory[];
  setCategories: React.Dispatch<React.SetStateAction<CourseCategory[]>>;
  courseId: string; 
  canManageTopics: boolean;
  canManageCategories: boolean;
  newCategoryName: string;
  onNewCategoryNameChange: (value: string) => void;
  onAddCategory: () => void;
  newTopicNames: Record<string, string>;
  onTopicNameChange: (categoryId: string, value: string) => void;
  onAddTopic: (categoryId: string) => void;
  editingTopic: Topic | null;
  editingName: string;
  onEditTopic: (topic: Topic) => void;
  onEditingNameChange: (value: string) => void;
  onSaveTopic: () => void;
  onCancelEdit: () => void;
  onDeleteTopic: (topicId: string) => void;
}

export function CourseTopicsByCategory({
  categories,
  setCategories,
  courseId,              
  canManageTopics,
  canManageCategories,
  newCategoryName,
  onNewCategoryNameChange,
  onAddCategory,
  newTopicNames,
  onTopicNameChange,
  onAddTopic,
  editingTopic,
  editingName,
  onEditTopic,
  onEditingNameChange,
  onSaveTopic,
  onCancelEdit,
  onDeleteTopic,
}: Props) {
  return (
    <div className="space-y-4">
      {canManageCategories && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/60 p-3">
          <Input
            placeholder="Enter new course category..."
            value={newCategoryName}
            onChange={(e) => onNewCategoryNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAddCategory()
            }}
            className="flex-1"
          />
          <Button onClick={onAddCategory} disabled={!newCategoryName.trim()}>
            <IconPlus className="mr-2 h-4 w-4" />
            Add Category
          </Button>
        </div>
      )}

      <div className="grid gap-4">
        {categories.map((category) => (
          <div key={category.id} className="space-y-3 rounded-lg border p-4 shadow-sm">
              <CategoryRow
              category={category}
              courseId={courseId}
              setCategories={setCategories}
              canManageCategories={canManageCategories}
            />

            {canManageTopics && (
              <div className="flex gap-2">
                <Input
                  placeholder="Enter new topic name..."
                  value={newTopicNames[category.id] ?? ""}
                  onChange={(e) => onTopicNameChange(category.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onAddTopic(category.id)
                  }}
                  className="flex-1"
                />
                <Button
                  onClick={() => onAddTopic(category.id)}
                  disabled={!newTopicNames[category.id]?.trim()}
                >
                  <IconPlus className="mr-2 h-4 w-4" />
                  Add Topic
                </Button>
              </div>
            )}

            <div className="grid gap-2">
              {category.topics.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  No topics in this category yet.
                </p>
              ) : (
                category.topics.map((topic) => (
                  <div
                    key={topic.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    {editingTopic?.id === topic.id ? (
                      <div className="flex w-full items-center gap-2">
                        <Input
                          value={editingName}
                          onChange={(e) => onEditingNameChange(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && onSaveTopic()}
                          className="flex-1"
                        />
                        <Button size="sm" onClick={onSaveTopic}>
                          Save
                        </Button>
                        <Button size="sm" variant="outline" onClick={onCancelEdit}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1">
                          <h4 className="font-medium">{topic.name}</h4>
                          {topic.description && (
                            <p className="text-sm text-muted-foreground">{topic.description}</p>
                          )}
                        </div>

                        {canManageTopics && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onEditTopic(topic)}
                            >
                              <IconEdit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 hover:text-red-700"
                              onClick={() => onDeleteTopic(topic.id)}
                            >
                              <IconTrash className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        ))}

        {categories.length === 0 && (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            No categories yet. {canManageCategories ? "Add one to start organizing topics." : ""}
          </p>
        )}
      </div>
    </div>
  )
}
