import { useState, useEffect } from 'react'
import { Link } from 'react-router'
import { IconBook } from '@tabler/icons-react'
import { Button, Card, CardContent, CourseCard, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Label, PageHeading, Textarea } from '@eduai/ui'
import type { Course, UpdateCourseInput } from '~/hooks/api/use-courses'

interface Props {
  courses: Course[]
  onEditCourse: (id: string, data: UpdateCourseInput) => Promise<void>
  onPublishToggle: (id: string, publish: boolean) => Promise<void>
}

export function CoursesInstructorView({ courses, onEditCourse, onPublishToggle }: Props) {
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)

  // Safety cleanup: if the Radix DropdownMenu→Dialog lifecycle race left
  // pointer-events:none on <body>, clear it once the dialog is fully closed.
  useEffect(() => {
    if (!editingCourse) {
      document.body.style.pointerEvents = ''
    }
  }, [editingCourse])

  const handleEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editingCourse) return
    const fd = new FormData(e.currentTarget)
    await onEditCourse(editingCourse.id, {
      name: fd.get('name') as string,
      aiInstructions: (fd.get('aiInstructions') as string) || undefined,
    })
    setEditingCourse(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeading heading="My Courses" subheading="Courses you are teaching" />

      {courses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">You have no courses assigned yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {courses.map((course, index) => (
            <CourseCard
              key={course.id}
              id={course.id}
              code={course.code}
              name={course.name}
              description={course.description}
              term={course.term}
              year={course.year}
              isPublished={course.isPublished}
              department={course.department}
              colorIndex={index}
              href={`/courses/${course.id}`}
              LinkComponent={Link}
              actions={{
                showPublish: true,
                isPublished: course.isPublished,
                onPublishToggle: () => onPublishToggle(course.id, !course.isPublished),
                showEdit: true,
                onEdit: () => setTimeout(() => setEditingCourse(course), 0),
              }}
            />
          ))}
        </div>
      )}

      <Dialog open={!!editingCourse} onOpenChange={(open) => !open && setEditingCourse(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit course</DialogTitle></DialogHeader>
          {editingCourse && (
            <form onSubmit={handleEdit} className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-name">Course name</Label>
                <Input id="edit-name" name="name" defaultValue={editingCourse.name} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-ai">AI instructions</Label>
                <Textarea id="edit-ai" name="aiInstructions" defaultValue={editingCourse.aiInstructions} rows={2} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditingCourse(null)}>Cancel</Button>
                <Button type="submit">Save changes</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
