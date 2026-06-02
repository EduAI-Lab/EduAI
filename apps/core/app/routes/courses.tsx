import { useEffect, useState } from "react"
import { useLoaderData, Form, redirect, Link } from "react-router"
import type { LoaderFunctionArgs } from "react-router"
import {
  IconPlus,
  IconEdit,
  IconTrash,
  IconBook,
  IconCalendar,
  IconUser,
  IconSettings,
  IconEye
} from "@tabler/icons-react"

import { auth } from "~/lib/auth/server"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"
import { Badge } from "~/components/ui/badge"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader as AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "~/components/ui/alert-dialog"
import { Separator } from "~/components/ui/separator"
import { AppSidebar } from "~/components/app-sidebar"
import { SiteHeader } from "~/components/site-header"
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar"

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request)

  if (!session?.user) {
    return redirect("/auth/login")
  }

  return {
    user: session.user,
  }
}

type Course = {
  id: string
  name: string
  code: string
  description: string | null
  term: string
  year: number
  isActive: boolean
  aiInstructions: string
  professorId: string
  createdAt: string
  updatedAt: string
}

export default function CoursesPage() {
  const { user } = useLoaderData<typeof loader>()
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)

  const isAdmin = user.role === "ADMIN"
  const isProfessor = user.role === "INSTRUCTOR"
  const isTA = user.role === "TA"
  const isStudent = user.role === "STUDENT"

  // Fetch courses
  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const response = await fetch("/api/courses")
        if (response.ok) {
          const data = await response.json()
          setCourses(data.courses)
        }
      } catch (error) {
        console.error("Failed to fetch courses:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchCourses()
  }, [])

  // Filter courses based on role (client-side filtering since API doesn't filter)
  const filteredCourses = courses.filter(course => {
    if (isAdmin) return true
    if (isProfessor) return course.professorId === user.id
    // For TA and STUDENT, we'd need enrollment data from the API
    // For now, showing all courses since API doesn't provide filtering
    return true
  })

  const handleCreateCourse = async (formData: FormData) => {
    try {
      const response = await fetch("/api/courses", {
        method: "POST",
        body: formData,
      })

      if (response.ok) {
        const newCourse = await response.json()
        setCourses([...courses, newCourse])
        setCreateDialogOpen(false)
      } else {
        const error = await response.text()
        alert(`Failed to create course: ${error}`)
      }
    } catch (error) {
      console.error("Failed to create course:", error)
    }
  }

  const handleUpdateCourse = async (courseId: string, data: Partial<Course>) => {
    try {
      const response = await fetch(`/api/courses/${courseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })

      if (response.ok) {
        const updatedCourse = await response.json()
        setCourses(courses.map(c => c.id === courseId ? updatedCourse : c))
        setEditDialogOpen(false)
        setEditingCourse(null)
      } else {
        const error = await response.text()
        alert(`Failed to update course: ${error}`)
      }
    } catch (error) {
      console.error("Failed to update course:", error)
    }
  }

  const getRoleBasedActions = (course: Course) => {
    if (isAdmin) {
      return (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingCourse(course)
              setEditDialogOpen(true)
            }}
          >
            <IconEdit className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
            <IconTrash className="w-4 h-4" />
          </Button>
        </div>
      )
    }

    if (isProfessor && course.professorId === user.id) {
      return (
        <div onClick={(e) => e.stopPropagation()}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingCourse(course)
              setEditDialogOpen(true)
            }}
          >
            <IconEdit className="w-4 h-4" />
          </Button>
        </div>
      )
    }

    return (
      <div onClick={(e) => e.stopPropagation()}>
        <Button variant="outline" size="sm">
          <IconEye className="w-4 h-4" />
        </Button>
      </div>
    )
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" user={user} />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <div className="px-4 lg:px-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">Courses</h2>
                    <p className="text-muted-foreground">
                      {isAdmin && "Manage all courses in the system"}
                      {isProfessor && "View and manage your courses"}
                      {(isTA || isStudent) && "View your enrolled courses"}
                    </p>
                  </div>
                  {isAdmin && (
                    <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                      <DialogTrigger asChild>
                        <Button>
                          <IconPlus className="w-4 h-4 mr-2" />
                          Create Course
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Create New Course</DialogTitle>
                          <DialogDescription>
                            Create a new course for the current academic term.
                          </DialogDescription>
                        </DialogHeader>
                        <Form onSubmit={(e) => {
                          e.preventDefault()
                          const formData = new FormData(e.target as HTMLFormElement)
                          handleCreateCourse(formData)
                        }}>
                          <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                              <Label htmlFor="course-name">Course Name</Label>
                              <Input
                                id="course-name"
                                name="name"
                                placeholder="Introduction to Computer Science"
                                required
                              />
                            </div>
                            <div className="grid gap-2">
                              <Label htmlFor="course-code">Course Code</Label>
                              <Input
                                id="course-code"
                                name="code"
                                placeholder="CS101"
                                required
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="grid gap-2">
                                <Label htmlFor="course-term">Term</Label>
                                <Select name="term" defaultValue="Fall">
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="Fall">Fall</SelectItem>
                                    <SelectItem value="Spring">Spring</SelectItem>
                                    <SelectItem value="Summer">Summer</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="grid gap-2">
                                <Label htmlFor="course-year">Year</Label>
                                <Input
                                  id="course-year"
                                  name="year"
                                  type="number"
                                  defaultValue={new Date().getFullYear()}
                                  required
                                />
                              </div>
                            </div>
                            <div className="grid gap-2">
                              <Label htmlFor="ai-instructions">AI Instructions</Label>
                              <Textarea
                                id="ai-instructions"
                                name="aiInstructions"
                                placeholder="Instructions for AI assistant behavior in this course..."
                                rows={3}
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                              Cancel
                            </Button>
                            <Button type="submit">Create Course</Button>
                          </div>
                        </Form>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              </div>

              <div className="px-4 lg:px-6">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="text-muted-foreground">Loading courses...</div>
                  </div>
                ) : filteredCourses.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-8">
                      <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
                      <p className="text-muted-foreground text-center">
                        {isAdmin ? "No courses have been created yet." : "No courses available."}
                      </p>
                      {isAdmin && (
                        <Button className="mt-4" onClick={() => setCreateDialogOpen(true)}>
                          <IconPlus className="w-4 h-4 mr-2" />
                          Create Your First Course
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredCourses.map((course) => (
                      <Card key={course.id} className="hover:shadow-md transition-shadow">
                        <Link to={`/courses/${course.id}`} className="block">
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <CardTitle className="text-lg">{course.code}</CardTitle>
                              <CardDescription className="mt-1">
                                {course.name}
                              </CardDescription>
                            </div>
                            {getRoleBasedActions(course)}
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
                            <div className="flex items-center gap-1">
                              <IconCalendar className="w-4 h-4" />
                              {course.term} {course.year}
                            </div>
                            <Badge variant={course.isActive ? "default" : "secondary"}>
                              {course.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                          {course.description && (
                            <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                              {course.description}
                            </p>
                          )}
                          {course.aiInstructions && (
                            <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                              <div className="flex items-center gap-1 mb-1">
                                <IconSettings className="w-3 h-3" />
                                AI Instructions
                              </div>
                              <p className="line-clamp-2">{course.aiInstructions}</p>
                            </div>
                          )}
                        </CardContent>
                        </Link>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>

      {/* Edit Course Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Course</DialogTitle>
            <DialogDescription>
              Update the course information below.
            </DialogDescription>
          </DialogHeader>
          {editingCourse && (
            <Form onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.target as HTMLFormElement)
              const data = {
                name: formData.get("name") as string,
                code: formData.get("code") as string,
                term: formData.get("term") as string,
                year: parseInt(formData.get("year") as string),
                aiInstructions: formData.get("aiInstructions") as string,
              }
              handleUpdateCourse(editingCourse.id, data)
            }}>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-course-name">Course Name</Label>
                  <Input
                    id="edit-course-name"
                    name="name"
                    defaultValue={editingCourse.name}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-course-code">Course Code</Label>
                  <Input
                    id="edit-course-code"
                    name="code"
                    defaultValue={editingCourse.code}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="edit-course-term">Term</Label>
                    <Select name="term" defaultValue={editingCourse.term}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Fall">Fall</SelectItem>
                        <SelectItem value="Spring">Spring</SelectItem>
                        <SelectItem value="Summer">Summer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-course-year">Year</Label>
                    <Input
                      id="edit-course-year"
                      name="year"
                      type="number"
                      defaultValue={editingCourse.year}
                      required
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-ai-instructions">AI Instructions</Label>
                  <Textarea
                    id="edit-ai-instructions"
                    name="aiInstructions"
                    defaultValue={editingCourse.aiInstructions}
                    rows={3}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Save Changes</Button>
              </div>
            </Form>
          )}
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  )
}
