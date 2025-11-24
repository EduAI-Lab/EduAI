import { useState } from "react"
import { useLoaderData, useParams, redirect, useFetcher } from "react-router"
import type { LoaderFunctionArgs } from "react-router"
import { IconBook, IconUpload, IconUsers, IconCalendar, IconSettings, IconPlus, IconEdit, IconTrash } from "@tabler/icons-react"

import { auth } from "~/lib/auth/server"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"
import { Badge } from "~/components/ui/badge"
import { Input } from "~/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { AppSidebar } from "~/components/app-sidebar"
import { SiteHeader } from "~/components/site-header"
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar"
import { CourseMaterialsUpload } from "~/components/course-materials-upload"
import { useApiKeys } from "~/hooks/use-api-keys"
import prisma from "~/lib/prisma.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request)

  if (!session?.user) {
    return redirect("/auth/login")
  }

  const courseId = params.courseId
  if (!courseId) {
    return redirect("/courses")
  }

  // Fetch course details directly from database
  try {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        professor: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        categories:{
          include: {
            topics: { orderBy: { order: 'asc' } }
        }}
      }
    })

    if (!course) {
      return redirect("/courses")
    }
  console.log("Fetched course:", JSON.stringify(course, null, 2))
    return {
      course,
      user: session.user
    }

  } catch (error) {
    console.error("Failed to fetch course:", error)
    return redirect("/courses")
  }
}


type Topic = {
  id: string
  name: string
  description: string | null
  order: number
  createdAt: string
  updatedAt: string
  categoryId : string 
}
// I added a coure category type here.
type CourseCategory = {
  id : string 
  name : string
  description: string | null
  courseId: string
  topics: Topic[] 
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
  categories: CourseCategory[]
}

export default function CourseDetailPage() {
  const { course, user } = useLoaderData<typeof loader>()
  const { courseId } = useParams()
  const { getValidApiKeys } = useApiKeys()
  const [activeTab, setActiveTab] = useState("overview")
  const [topics, setTopics] = useState<Topic[]>((course as any).topics || [])
  const [newTopicName, setNewTopicName] = useState("")
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null)
  const [editingName, setEditingName] = useState("")
  const fetcher = useFetcher()

  const isAdmin = user.role === "ADMIN"
  const isProfessor = user.role === "PROFESSOR"
  const isTA = user.role === "TA"
  const isStudent = user.role === "STUDENT"

  // Check if user has access to this course
  const hasAccess = isAdmin ||
    (isProfessor && course.professorId === user.id) ||
    isTA || isStudent // For now, allowing all TAs and students

  if (!hasAccess) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card>
          <CardContent className="p-8">
            <p className="text-muted-foreground">You don't have access to this course.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const canManageMaterials = isAdmin || (isProfessor && course.professorId === user.id)
  const canManageTopics = isAdmin || (isProfessor && course.professorId === user.id)

  const handleAddTopic = async () => {
    if (!newTopicName.trim()) return

    /// changed the POST endpoint to api/courses/:courseId/topics
    const response = await fetch(`/api/courses/${courseId}/topics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newTopicName.trim(),
        courseId: courseId,
      })
    })

    if (response.ok) {
      const newTopic = await response.json()
      setTopics([...topics, newTopic])
      setNewTopicName("")
    }
  }

  const handleEditTopic = (topic: Topic) => {
    setEditingTopic(topic)
    setEditingName(topic.name)
  }

  const handleUpdateTopic = async () => {
    if (!editingTopic || !editingName.trim()) return
    /// changed the PATCH endpoint to api/courses/:courseId/topics/:topicId
    const response = await fetch(`/api/courses/${courseId}/topics/${editingTopic.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editingName.trim()
      })
    })

    if (response.ok) {
      const updatedTopic = await response.json()
      setTopics(topics.map(t => t.id === editingTopic.id ? updatedTopic : t))
      setEditingTopic(null)
      setEditingName("")
    }
  }

  const handleDeleteTopic = async (topicId: string) => {
    if (!confirm('Are you sure you want to delete this topic?')) return
    /// changed the DELETE endpoint to api/courses/:courseId/topics/:topicId
    const response = await fetch(`/api/courses/${courseId}/topics/${topicId}`, {
      method: 'DELETE'
    })

    if (response.ok) {
      setTopics(topics.filter(t => t.id !== topicId))
    }
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
        <SiteHeader user={user} />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <div className="px-4 lg:px-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">{course.code}: {course.name}</h2>
                    <p className="text-muted-foreground">
                      {course.term} {course.year} • {course.isActive ? "Active" : "Inactive"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm">
                      <IconUsers className="w-4 h-4 mr-2" />
                      View Students
                    </Button>
                    {canManageMaterials && (
                      <Button variant="outline" size="sm">
                        <IconSettings className="w-4 h-4 mr-2" />
                        Settings
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="px-4 lg:px-6">
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="topics">Topics</TabsTrigger>
                    <TabsTrigger value="materials">Materials</TabsTrigger>
                    <TabsTrigger value="chat">Chat</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="mt-6">
                    <div className="grid gap-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <IconBook className="h-5 w-5" />
                            Course Information
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid gap-4">
                            <div>
                              <h3 className="font-medium">Description</h3>
                              <p className="text-muted-foreground mt-1">
                                {course.description || "No description available."}
                              </p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <h3 className="font-medium">Term</h3>
                                <p className="text-muted-foreground mt-1">{course.term} {course.year}</p>
                              </div>
                              <div>
                                <h3 className="font-medium">Status</h3>
                                <Badge variant={course.isActive ? "default" : "secondary"} className="mt-1">
                                  {course.isActive ? "Active" : "Inactive"}
                                </Badge>
                              </div>
                            </div>
                            {course.aiInstructions && (
                              <div>
                                <h3 className="font-medium">AI Instructions</h3>
                                <p className="text-muted-foreground mt-1">{course.aiInstructions}</p>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  <TabsContent value="topics" className="mt-6">
                    <div className="grid gap-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <IconBook className="h-5 w-5" />
                            Course Topics
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {canManageTopics ? (
                            <div className="space-y-4">
                              {/* Add New Topic */}
                              <div className="flex gap-2">
                                <Input
                                  placeholder="New topic name..."
                                  value={newTopicName}
                                  onChange={(e) => setNewTopicName(e.target.value)}
                                  onKeyPress={(e) => e.key === 'Enter' && handleAddTopic()}
                                  className="flex-1"
                                />
                                <Button onClick={handleAddTopic} disabled={!newTopicName.trim()}>
                                  <IconPlus className="w-4 h-4 mr-2" />
                                  Add Topic
                                </Button>
                              </div>

                              {/* Topics List */}
                              <div className="grid gap-2">
                                {topics.map((topic) => (
                                  <div key={topic.id} className="flex items-center justify-between p-3 border rounded-lg">
                                    {editingTopic?.id === topic.id ? (
                                      <div className="flex items-center gap-2 flex-1">
                                        <Input
                                          value={editingName}
                                          onChange={(e) => setEditingName(e.target.value)}
                                          onKeyPress={(e) => e.key === 'Enter' && handleUpdateTopic()}
                                          className="flex-1"
                                        />
                                        <Button size="sm" onClick={handleUpdateTopic}>
                                          Save
                                        </Button>
                                        <Button 
                                          size="sm" 
                                          variant="outline" 
                                          onClick={() => {
                                            setEditingTopic(null)
                                            setEditingName("")
                                          }}
                                        >
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
                                        <div className="flex gap-2">
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleEditTopic(topic)}
                                          >
                                            <IconEdit className="w-4 h-4" />
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleDeleteTopic(topic.id)}
                                            className="text-red-600 hover:text-red-700"
                                          >
                                            <IconTrash className="w-4 h-4" />
                                          </Button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                ))}
                                {topics.length === 0 && (
                                  <p className="text-muted-foreground text-center py-8">
                                    No topics added yet. Add your first topic above.
                                  </p>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center py-8">
                              <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
                              <p className="text-muted-foreground text-center">
                                Only professors and administrators can manage course topics.
                              </p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  <TabsContent value="materials" className="mt-6">
                    {canManageMaterials ? (
                      <CourseMaterialsUpload
                        courseId={courseId!}
                        apiKeys={getValidApiKeys()}
                      />
                    ) : (
                      <Card>
                        <CardContent className="flex flex-col items-center justify-center py-8">
                          <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
                          <p className="text-muted-foreground text-center">
                            Only professors and administrators can manage course materials.
                          </p>
                        </CardContent>
                      </Card>
                    )}
                  </TabsContent>

                  <TabsContent value="chat" className="mt-6">
                    <Card>
                      <CardHeader>
                        <CardTitle>Course Chat</CardTitle>
                        <CardDescription>
                          Chat with AI about this course's materials and content.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-col items-center justify-center py-8">
                          <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
                          <p className="text-muted-foreground text-center mb-4">
                            Use the main chat page to interact with course materials.
                          </p>
                          <Button asChild>
                            <a href="/chat">Go to Chat</a>
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}