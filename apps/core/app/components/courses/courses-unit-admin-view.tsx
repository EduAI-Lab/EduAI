import { useState } from 'react'
import { Link } from 'react-router'
import { IconPlus, IconEdit, IconBook, IconCalendar, IconEye, IconEyeOff } from '@tabler/icons-react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Textarea } from '~/components/ui/textarea'
import { DEPARTMENTS, getDepartmentLabel } from '~/lib/departments'
import type { Course, CreateCourseInput, UpdateCourseInput } from '~/hooks/api/use-courses'

interface Props {
  courses: Course[]         // already filtered to this unit's courses by the route
  authorizedUnits: string[] // e.g. ['COSC', 'MATH']
  onCreateCourse: (data: CreateCourseInput) => Promise<void>
  onEditCourse: (id: string, data: UpdateCourseInput) => Promise<void>
  onPublishToggle: (id: string, publish: boolean) => Promise<void>
}

// Only show department options that are both canonical and in the user's authorized units
function useAuthorizedDepts(authorizedUnits: string[]) {
  return DEPARTMENTS.filter((d) => authorizedUnits.includes(d.code))
}

export function CoursesUnitAdminView({ courses, authorizedUnits, onCreateCourse, onEditCourse, onPublishToggle }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const authorizedDepts = useAuthorizedDepts(authorizedUnits)
  const [selectedDept, setSelectedDept] = useState<string>(authorizedDepts[0]?.code ?? '')

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const dept = fd.get('department') as string
    const codeSuffix = (fd.get('codeSuffix') as string).trim()
    // Combine dept prefix + suffix into canonical course code (e.g. "COSC 101")
    const code = dept ? `${dept} ${codeSuffix}` : codeSuffix
    await onCreateCourse({
      name: fd.get('name') as string,
      code,
      term: fd.get('term') as string,
      year: parseInt(fd.get('year') as string),
      department: dept || undefined,
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

  const unitLabel = authorizedDepts.length > 0
    ? authorizedDepts.map((d) => `${d.label} (${d.code})`).join(', ')
    : authorizedUnits.join(', ') || '—'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Courses</h2>
          <p className="text-muted-foreground">
            Managing: <span className="font-medium">{unitLabel}</span>
          </p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button disabled={authorizedDepts.length === 0}>
              <IconPlus className="w-4 h-4 mr-2" />
              Create Course
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Course</DialogTitle>
              <DialogDescription>
                New courses will be assigned to one of your authorized departments.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="ua-name">Course Name</Label>
                <Input id="ua-name" name="name" placeholder="Introduction to Computer Science" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ua-dept">Department</Label>
                {authorizedDepts.length === 1 ? (
                  <>
                    <input type="hidden" name="department" value={authorizedDepts[0].code} />
                    <Input
                      id="ua-dept"
                      value={`${authorizedDepts[0].label} (${authorizedDepts[0].code})`}
                      readOnly
                      className="bg-muted"
                    />
                  </>
                ) : (
                  <Select
                    name="department"
                    value={selectedDept}
                    onValueChange={setSelectedDept}
                    required
                  >
                    <SelectTrigger id="ua-dept"><SelectValue placeholder="Select department" /></SelectTrigger>
                    <SelectContent>
                      {authorizedDepts.map((d) => (
                        <SelectItem key={d.code} value={d.code}>
                          {d.label} ({d.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ua-code">Course Number</Label>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded-md border bg-muted px-3 py-2 text-sm font-mono text-muted-foreground">
                    {selectedDept || authorizedDepts[0]?.code || '—'}
                  </span>
                  <Input
                    id="ua-code"
                    name="codeSuffix"
                    placeholder="101"
                    className="font-mono"
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  The full course code will be e.g. <span className="font-mono">{selectedDept || authorizedDepts[0]?.code || 'DEPT'} 101</span>
                </p>
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
            {authorizedDepts.length > 0 && (
              <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                <IconPlus className="w-4 h-4 mr-2" />
                Create First Course
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <Card key={course.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <Link to={`/courses/${course.id}`} className="flex-1 min-w-0">
                    <CardTitle className="text-lg truncate">{course.code}</CardTitle>
                    <CardDescription className="mt-1 line-clamp-2">{course.name}</CardDescription>
                  </Link>
                  <div className="flex gap-1 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={course.isPublished ? 'Unpublish' : 'Publish'}
                      onClick={() => onPublishToggle(course.id, !course.isPublished)}
                    >
                      {course.isPublished
                        ? <IconEyeOff className="w-4 h-4 text-muted-foreground" />
                        : <IconEye className="w-4 h-4 text-blue-600" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => { e.stopPropagation(); setEditingCourse(course) }}
                    >
                      <IconEdit className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <IconCalendar className="w-4 h-4" />
                    {course.term} {course.year}
                  </div>
                  {course.department && (
                    <Badge variant="outline">{getDepartmentLabel(course.department)}</Badge>
                  )}
                  <Badge variant={course.isPublished ? 'default' : 'secondary'}>
                    {course.isPublished ? 'Published' : 'Draft'}
                  </Badge>
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
