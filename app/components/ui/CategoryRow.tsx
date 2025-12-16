import { useState } from "react";
import { toast } from "react-hot-toast";
import type { CourseCategory } from "~/types/course";
import { Button } from "~/components/ui/button";
import { IconEdit, IconCheck, IconX } from "@tabler/icons-react";
import { Input } from "~/components/ui/input";

type Props = {
    category: CourseCategory;
    courseId: string;
    setCategories: React.Dispatch<React.SetStateAction<CourseCategory[]>>;
    canManageCategories: boolean;
    }
    
export function CategoryRow({ category, courseId, setCategories, canManageCategories }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [loading, setLoading] = useState(false);

  async function handleRename() {
    setLoading(true);

    const res = await fetch(
      `/api/courses/${courseId}/categories/${category.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }
    );

    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Failed to rename category");
      setLoading(false);
      return;
    }

    const updated = await res.json();

    setCategories((prev) =>
    prev.map((c) =>
        c.id === category.id
        ? { ...c, ...updated, topics: c.topics } // preserve topics
        : c
        )
    )


    setIsEditing(false);
    setLoading(false);
  }

  return (
<div className="flex items-center justify-between w-full">
  {isEditing ? (
    <div className="flex items-center gap-2 w-full">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="flex-1"
        disabled={loading}
      />

      <Button
        size="sm"
        onClick={handleRename}
        disabled={loading || !name.trim()}
      >
        <IconCheck className="mr-1 h-4 w-4" />
        Save
      </Button>

      <Button
        size="sm"
        variant="outline"
        onClick={() => setIsEditing(false)}
        disabled={loading}
      >
        <IconX className="mr-1 h-4 w-4" />
        Cancel
      </Button>
    </div>
  ) : (
    <>
      <span className="font-medium">{category.name}</span>

      {canManageCategories && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setIsEditing(true)}
        >
          <IconEdit className="mr-1 h-4 w-4" />
          Rename
        </Button>
      )}
    </>
  )}
</div>

  );
}
