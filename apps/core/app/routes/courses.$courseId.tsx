import { useState, useCallback } from 'react'
import { redirect, useLoaderData } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'

import { auth } from '~/lib/auth/server'
import prisma from '~/lib/prisma.server'
import { AppSidebar } from '~/components/app-sidebar'
import { SiteHeader } from '~/components/site-header'
import { SidebarInset, SidebarProvider } from '~/components/ui/sidebar'
import { CourseDetailManagerView } from '~/components/courses/course-detail-manager-view'
import { CourseDetailTaView } from '~/components/courses/course-detail-ta-view'
import { CourseDetailStudentView } from '~/components/courses/course-detail-student-view'
import { useCourseTopics } from '~/hooks/api/use-course-topics'
import { useCourseEnrollments } from '~/hooks/api/use-course-enrollments'
import { useCourseMaterials } from '~/hooks/api/use-course-materials'
import { useCourseTAs } from '~/hooks/api/use-course-tas'
import { useApiKeys } from '~/hooks/use-api-keys'
import type { CourseMaterial as UploadMaterial } from '~/components/course-materials-upload'
import { resolveCourseAccess } from '~/lib/rbac/resolve-course-access.server'
import type { RbacUser } from '~/lib/rbac'

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request)
  if (!session?.user) return redirect('/auth/login')

  const courseId = params.courseId
  if (!courseId) return redirect('/courses')

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      professor: { select: { id: true, name: true, email: true } },
      tas: {
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!course) return redirect('/courses')

  const user = session.user
  const rbacUser: RbacUser = {
    id: user.id,
    role: user.role as RbacUser['role'],
    authorizedUnits: (user as any).authorizedUnits ?? [],
  }

  const access = await resolveCourseAccess(rbacUser, {
    id: course.id,
    professorId: course.professorId,
    department: course.department,
  })

  // No access at all — redirect (e.g. TA opened a course they do not assist)
  if (!access) return redirect('/courses?access=denied')

  return {
    course: {
      ...course,
      createdAt: course.createdAt.toISOString(),
      updatedAt: course.updatedAt.toISOString(),
    },
    user,
    access,
  }
}

export default function CourseDetailPage() {
  const { course, user, access } = useLoaderData<typeof loader>()
  const { topics, createTopic, deleteTopic } = useCourseTopics(course.id)
  const { enrollments } = useCourseEnrollments(course.id)
  const { materials, uploadMaterial } = useCourseMaterials(course.id)
  const { tas, addTA, removeTA } = useCourseTAs(course.id)
  const { getValidApiKeys } = useApiKeys()
  const [isUploading, setIsUploading] = useState(false)
  const [materialsError, setMaterialsError] = useState<string | null>(null)
  const [materialsSuccess, setMaterialsSuccess] = useState<string | null>(null)

  const handleAssignProfessor = useCallback(async (professorId: string) => {
    const res = await fetch(`/api/courses/${course.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ professorId }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Failed to assign professor')
    }
  }, [course.id])

  const uploadMaterials: UploadMaterial[] = materials.map((m) => ({
    id: m.id,
    title: m.title,
    mimeType: m.mimeType,
    fileSize: m.fileSize,
    status: m.status,
    createdAt: m.createdAt,
  }))

  const handleFileSelect = async (file: File) => {
    setIsUploading(true)
    setMaterialsError(null)
    setMaterialsSuccess(null)
    try {
      await uploadMaterial(file, getValidApiKeys())
      setMaterialsSuccess('Material uploaded successfully')
    } catch (e) {
      setMaterialsError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <SidebarProvider
      style={{
        '--sidebar-width': 'calc(var(--spacing) * 72)',
        '--header-height': 'calc(var(--spacing) * 12)',
      } as React.CSSProperties}
    >
      <AppSidebar variant="inset" user={user} />
      <SidebarInset>
        <SiteHeader user={user} />
        <div className="flex flex-1 flex-col">
          <div className="px-4 lg:px-6 py-6">
            {access === 'admin' || access === 'unit' || access === 'instructor' ? (
              <CourseDetailManagerView
                course={course}
                access={access}
                topics={topics}
                enrollments={enrollments}
                materials={uploadMaterials}
                tas={tas}
                isUploading={isUploading}
                materialsError={materialsError}
                materialsSuccess={materialsSuccess}
                onFileSelect={handleFileSelect}
                onCreateTopic={async (name) => { await createTopic(name) }}
                onDeleteTopic={async (id) => { await deleteTopic(id) }}
                onAssignProfessor={handleAssignProfessor}
                onAddTA={addTA}
                onRemoveTA={removeTA}
              />
            ) : access === 'ta' ? (
              <CourseDetailTaView
                course={course}
                topics={topics}
                materials={uploadMaterials}
                isUploading={isUploading}
                materialsError={materialsError}
                materialsSuccess={materialsSuccess}
                onFileSelect={handleFileSelect}
              />
            ) : (
              <CourseDetailStudentView
                course={course}
                materials={materials}
                topics={topics}
              />
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
