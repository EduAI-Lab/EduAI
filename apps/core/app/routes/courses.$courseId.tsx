import { useCallback, useEffect, useState } from "react"
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
import prisma from "~/lib/prisma.server"
import { Label } from "~/components/ui/label"
import { Input } from "~/components/ui/input"

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
        enrollments: {
          where: { userId: session.user.id, isActive: true },
          select: { role: true },
        },
      },
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

export default function CourseDetailPage() {
  const { course, user } = useLoaderData<typeof loader>()
  const { courseId } = useParams()
  const { getValidApiKeys } = useApiKeys()
  const [activeTab, setActiveTab] = useState("overview")

  const [materials, setMaterials] = useState<CourseMaterial[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [materialsError, setMaterialsError] = useState<string | null>(null)
  const [materialsSuccess, setMaterialsSuccess] = useState<string | null>(null)

  // RAG settings local state (pre-populated from loaded course)
  const [ragTopK, setRagTopK] = useState<string>(course.ragTopK?.toString() ?? "")
  const [ragThreshold, setRagThreshold] = useState<string>(
    course.ragSimilarityThreshold?.toString() ?? "",
  )
  const [ragSaving, setRagSaving] = useState(false)
  const [ragSaveMsg, setRagSaveMsg] = useState<string | null>(null)

  async function saveRagSettings() {
    setRagSaving(true)
    setRagSaveMsg(null)
    try {
      const payload: Record<string, number | null> = {
        ragTopK: ragTopK === "" ? null : parseInt(ragTopK, 10),
        ragSimilarityThreshold: ragThreshold === "" ? null : parseFloat(ragThreshold),
      }
      const res = await fetch(`/api/courses/${courseId}/rag-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setRagSaveMsg("Saved.")
      } else {
        const err = await res.json().catch(() => ({}))
        setRagSaveMsg(err?.error ?? "Save failed.")
      }
    } catch {
      setRagSaveMsg("Network error.")
    } finally {
      setRagSaving(false)
    }
  }

  const isAdmin = user.role === "ADMIN"
  const isInstructor = course.enrollments.some((e) => e.role === "INSTRUCTOR")
  const isTA = course.enrollments.some((e) => e.role === "TA")
  const isStudent = course.enrollments.some((e) => e.role === "STUDENT")

  // Check if user has access to this course
  const hasAccess = isAdmin || isInstructor || isTA || isStudent

  const canManageMaterials = isAdmin || isInstructor

  const loadMaterials = useCallback(async () => {
    try {
      const response = await fetch(`/api/courses/${courseId}/materials`)
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Failed to load materials")
      }

      setMaterials(result.materials || [])
    } catch (err) {
      console.error("Failed to load materials:", err)
    }
  }, [courseId])

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

  useEffect(() => {
    if (canManageMaterials) {
      loadMaterials()
    }
  }, [canManageMaterials, loadMaterials])

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
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="materials">Materials</TabsTrigger>
                    <TabsTrigger value="chat">Chat</TabsTrigger>
                    {canManageMaterials && (
                      <TabsTrigger value="settings">Settings</TabsTrigger>
                    )}
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

                  {canManageMaterials && (
                    <TabsContent value="settings" className="mt-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <IconSettings className="h-5 w-5" />
                            RAG Settings
                          </CardTitle>
                          <CardDescription>
                            Override the global retrieval defaults for this course. Leave a field
                            blank to use the platform default.
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="grid gap-6 max-w-sm">
                            <div className="grid gap-2">
                              <Label htmlFor="ragTopK">
                                Top-K chunks{" "}
                                <span className="text-muted-foreground text-xs">(default: 4)</span>
                              </Label>
                              <Input
                                id="ragTopK"
                                type="number"
                                min={1}
                                max={20}
                                placeholder="e.g. 6"
                                value={ragTopK}
                                onChange={(e) => setRagTopK(e.target.value)}
                              />
                              <p className="text-xs text-muted-foreground">
                                Maximum number of material chunks returned per RAG query (1–20).
                              </p>
                            </div>

                            <div className="grid gap-2">
                              <Label htmlFor="ragThreshold">
                                Similarity threshold{" "}
                                <span className="text-muted-foreground text-xs">(default: 0.5)</span>
                              </Label>
                              <Input
                                id="ragThreshold"
                                type="number"
                                min={0.01}
                                max={0.99}
                                step={0.05}
                                placeholder="e.g. 0.6"
                                value={ragThreshold}
                                onChange={(e) => setRagThreshold(e.target.value)}
                              />
                              <p className="text-xs text-muted-foreground">
                                Minimum cosine similarity score (0–1). Higher values return fewer
                                but more relevant chunks.
                              </p>
                            </div>

                            <div className="flex items-center gap-3">
                              <Button onClick={saveRagSettings} disabled={ragSaving}>
                                {ragSaving ? "Saving…" : "Save settings"}
                              </Button>
                              {ragSaveMsg && (
                                <span className="text-sm text-muted-foreground">{ragSaveMsg}</span>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </TabsContent>
                  )}
                </Tabs>
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}