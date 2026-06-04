import { useCallback, useEffect, useRef, useState } from "react"
import { useLoaderData, useParams, redirect } from "react-router"
import type { LoaderFunctionArgs } from "react-router"
import { IconBook, IconUpload, IconUsers, IconCalendar, IconSettings } from "@tabler/icons-react"

import { auth } from "~/lib/auth/server"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"
import { Badge } from "~/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { AppSidebar } from "~/components/app-sidebar"
import { SiteHeader } from "~/components/site-header"
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar"
import { CourseMaterialsUpload } from "~/components/course-materials-upload"
import type { CourseMaterial } from "~/components/course-materials-upload"
import { useApiKeys } from "~/hooks/use-api-keys"
import { readJsonResponse } from "~/lib/api/client"
import {
  formatReEmbedJobMessage,
  pollReEmbedJobUntilDone,
  type ReEmbedJobResponse,
} from "~/lib/api/re-embed-job.client"
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
        }
      }
    })

    if (!course) {
      return redirect("/courses")
    }

    return {
      course,
      user: session.user
    }
  } catch (error) {
    console.error("Failed to fetch course:", error)
    return redirect("/courses")
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

export default function CourseDetailPage() {
  const { course, user } = useLoaderData<typeof loader>()
  const { courseId } = useParams()
  const { getValidApiKeys } = useApiKeys()
  const [activeTab, setActiveTab] = useState("overview")

  const [materials, setMaterials] = useState<CourseMaterial[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isReEmbedding, setIsReEmbedding] = useState(false)
  const [reEmbedProgress, setReEmbedProgress] = useState<string | null>(null)
  const [materialsError, setMaterialsError] = useState<string | null>(null)
  const [materialsSuccess, setMaterialsSuccess] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isAdmin = user.role === "ADMIN"
  const isProfessor = user.role === "PROFESSOR"
  const isTA = user.role === "TA"
  const isStudent = user.role === "STUDENT"

  // Check if user has access to this course
  const hasAccess = isAdmin ||
    (isProfessor && course.professorId === user.id) ||
    isTA || isStudent // For now, allowing all TAs and students

  const canManageMaterials = isAdmin || (isProfessor && course.professorId === user.id)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const loadMaterials = useCallback(async () => {
    try {
      const response = await fetch(`/api/courses/${courseId}/materials`)
      const parsed = await readJsonResponse<{ materials?: CourseMaterial[]; error?: string }>(response)

      if (!parsed.ok) {
        throw new Error(parsed.error)
      }

      if (!response.ok) {
        throw new Error(parsed.data.error || "Failed to load materials")
      }

      setMaterials(parsed.data.materials || [])
    } catch (err) {
      console.error("Failed to load materials:", err)
    }
  }, [courseId])

  const startPolling = useCallback(() => {
    stopPolling()
    pollRef.current = setInterval(() => {
      void loadMaterials()
    }, 2000)
  }, [stopPolling, loadMaterials])

  const handleFileSelect = async (file: File) => {
    setIsUploading(true)
    setMaterialsError(null)
    setMaterialsSuccess(null)

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("apiKeys", JSON.stringify(getValidApiKeys()))

      const response = await fetch(`/api/courses/${courseId}/materials`, {
        method: "POST",
        body: formData,
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Failed to upload material")
      }

      await loadMaterials()
      setMaterialsSuccess("Material uploaded successfully!")
    } catch (err) {
      setMaterialsError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setIsUploading(false)
    }
  }

  const handleReEmbed = async () => {
    if (!courseId) return

    setIsReEmbedding(true)
    setReEmbedProgress(null)
    setMaterialsError(null)
    setMaterialsSuccess(null)
    startPolling()

    try {
      const response = await fetch(`/api/courses/${courseId}/re-embed`, {
        method: "POST",
      })
      const parsed = await readJsonResponse<{
        job?: { id: string }
        error?: string
        hint?: string
      }>(response)

      if (!parsed.ok) {
        throw new Error(parsed.error)
      }

      if (!response.ok || !parsed.data.job?.id) {
        throw new Error(
          [parsed.data.error, parsed.data.hint].filter(Boolean).join(" ") || "Re-index failed",
        )
      }

      const jobId = parsed.data.job.id
      const formatProgress = (job: ReEmbedJobResponse) => {
        if (job.currentMaterialTitle) {
          return `Re-indexing: ${job.processedCount + 1} of ${job.totalMaterials} — ${job.currentMaterialTitle}`
        }
        if (job.totalMaterials > 0) {
          return `Re-indexing: ${job.processedCount} of ${job.totalMaterials} complete`
        }
        return "Re-indexing materials…"
      }

      const finalJob = await pollReEmbedJobUntilDone(courseId, jobId, {
        onUpdate: (job) => setReEmbedProgress(formatProgress(job)),
      })

      await loadMaterials()
      if (finalJob.status === "FAILED") {
        throw new Error(finalJob.errorMessage || "Re-index failed")
      }
      setMaterialsSuccess(formatReEmbedJobMessage(finalJob))
    } catch (err) {
      setMaterialsError(err instanceof Error ? err.message : "Re-index failed")
    } finally {
      setIsReEmbedding(false)
      setReEmbedProgress(null)
      stopPolling()
      await loadMaterials()
    }
  }

  useEffect(() => {
    if (canManageMaterials) {
      loadMaterials()
    }
    return () => stopPolling()
  }, [canManageMaterials, loadMaterials, stopPolling])

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
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
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

                  <TabsContent value="materials" className="mt-6">
                    {canManageMaterials ? (
                      <CourseMaterialsUpload
                        materials={materials}
                        isUploading={isUploading}
                        error={materialsError}
                        success={materialsSuccess}
                        onFileSelect={handleFileSelect}
                        courseId={courseId}
                        onMaterialsRefresh={() => {
                          void loadMaterials()
                        }}
                        onReEmbed={handleReEmbed}
                        isReEmbedding={isReEmbedding}
                        reEmbedProgress={reEmbedProgress}
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