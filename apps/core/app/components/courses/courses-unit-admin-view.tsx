import { useState } from 'react'
import { Link } from 'react-router'
import { IconPlus, IconEdit, IconBook, IconCalendar } from '@tabler/icons-react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Textarea } from '~/components/ui/textarea'
import type { Course, CreateCourseInput, UpdateCourseInput } from '~/hooks/api/use-courses'

interface Props {
  courses: Course[]         // already filtered to this unit's courses by the route
  authorizedUnits: string[] // e.g. ['COSC', 'MATH']
  onCreateCourse: (data: CreateCourseInput) => Promise<void>
  onEditCourse: (id: string, data: UpdateCourseInput) => Promise<void>
}

export function CoursesUnitAdminView({ courses, authorizedUnits, onCreateCourse, onEditCourse }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [selectedUnit, setSelectedUnit] = useState(authorizedUnits[0] ?? '')

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await onCreateCourse({
      name: fd.get('name') as string,
      code: fd.get('code') as string,
      term: fd.get('term') as string,
      year: parseInt(fd.get('year') as string),
      department: fd.get('department') as string,
      aiInstructions: (fd.get('aiInstructions') as string) || undefined,
    })
    setCreateOpen(false)
  }

  const handleEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editingCourse) return
    const fd = new FormData(e.currentTarget)
    await onEditCourse(editingCourse.id, {
      name: fd.get('name') as string,
      code: fd.get('code') as string,
      aiInstructions: (fd.get('aiInstructions') as string) || undefined,
    })
    setEditingCourse(null)
  }

  const unitLabel = authorizedUnits.join(', ')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Courses</h2>
          <p className="text-muted-foreground">
            Managing courses in: <span className="font-medium">{unitLabel}</span>
          </p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <IconPlus className="w-4 h-4 mr-2" />
              Create Course
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Course</DialogTitle>
              <DialogDescription>
                New courses will be assigned to one of your authorized units.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="ua-name">Course Name</Label>
                <Input id="ua-name" name="name" placeholder="Introduction to Computer Science" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ua-code">Course Code</Label>
                <Input id="ua-code" name="code" placeholder="COSC 101" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ua-dept">Department</Label>
                {authorizedUnits.length === 1 ? (
                  // Single unit — lock to it
                  <>
                    <Input name="department" value={authorizedUnits[0]} readOnly className="bg-muted" />
                  </>
                ) : (
                  <Select name="department" value={selectedUnit} onValueChange={setSelectedUnit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {authorizedUnits.map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Term</Label>
                  <Select name="term" defaultValue="Fall">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Fall">Fall</SelectItem>
                      <SelectItem value="Spring">Spring</SelectItem>
                      <SelectItem value="Summer">Summer</SelectItem>
                      <SelectItem value="Winter">Winter</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Year</Label>
                  <Input name="year" type="number" defaultValue={new Date().getFullYear()} required />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>AI Instructions</Label>
                <Textarea name="aiInstructions" rows={2} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit">Create Course</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {courses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No courses in {unitLabel} yet.</p>
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <IconPlus className="w-4 h-4 mr-2" />
              Create First Course
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <Card key={course.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <Link to={`/courses/${course.id}`} className="flex-1">
                    <CardTitle className="text-lg">{course.code}</CardTitle>
                    <CardDescription className="mt-1">{course.name}</CardDescription>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => { e.stopPropagation(); setEditingCourse(course) }}
                  >
                    <IconEdit className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <IconCalendar className="w-4 h-4" />
                    {course.term} {course.year}
                  </div>
                  <Badge variant={course.isActive ? 'default' : 'secondary'}>
                    {course.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  {course.department && (
                    <Badge variant="outline">{course.department}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editingCourse} onOpenChange={(open) => !open && setEditingCourse(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Course</DialogTitle></DialogHeader>
          {editingCourse && (
            <form onSubmit={handleEdit} className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Course Name</Label>
                <Input name="name" defaultValue={editingCourse.name} required />
              </div>
              <div className="grid gap-2">
                <Label>Code</Label>
                <Input name="code" defaultValue={editingCourse.code} required />
              </div>
              <div className="grid gap-2">
                <Label>AI Instructions</Label>
                <Textarea name="aiInstructions" defaultValue={editingCourse.aiInstructions} rows={2} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditingCourse(null)}>Cancel</Button>
                <Button type="submit">Save Changes</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
