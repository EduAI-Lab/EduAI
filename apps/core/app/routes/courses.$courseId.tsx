import { useState, useCallback } from 'react'
import { Link, redirect, useLoaderData, useRevalidator } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'

import { auth } from '~/lib/auth/server'
import prisma from '~/lib/prisma.server'
import { AppSidebar } from '~/components/app-sidebar'
import { SiteHeader } from '~/components/site-header'
import { SidebarInset, SidebarProvider } from '@eduai/ui'
import { CourseDetailManagerView } from '~/components/courses/course-detail-manager-view'
import { CourseDetailTaView } from '~/components/courses/course-detail-ta-view'
import { CourseDetailStudentView } from '~/components/courses/course-detail-student-view'
import { useCourseTopics } from '~/hooks/api/use-course-topics'
import { useCourseEnrollments } from '~/hooks/api/use-course-enrollments'
import { useCourseMaterials } from '~/hooks/api/use-course-materials'
import { useCourseTAs } from '~/hooks/api/use-course-tas'
import { useApiKeys } from '~/hooks/use-api-keys'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@eduai/ui'
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
      instructor: { select: { id: true, name: true, email: true } },
      tas: {
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!course) return redirect('/courses')

  const user = session.user
  let authorizedUnits: string[] = []
  if (user.role === 'UNIT_ADMIN') {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { authorizedUnits: true },
    })
    authorizedUnits = dbUser?.authorizedUnits ?? []
  }
  const rbacUser: RbacUser = {
    id: user.id,
    role: user.role as RbacUser['role'],
    authorizedUnits,
  }

  const access = await resolveCourseAccess(rbacUser, {
    id: course.id,
    instructorId: course.instructorId,
    department: course.department,
  })

  // No access at all — redirect (e.g. TA opened a course they do not assist)
  if (!access) return redirect('/courses?access=denied')

  // Students cannot view unpublished courses by direct URL
  if (access === 'student' && !course.isPublished) return redirect('/courses')

  const canManageStaff = access === 'admin' || access === 'unit'
  const [instructors, taUsers] = canManageStaff
    ? await Promise.all([
        prisma.user.findMany({
          where: { role: 'INSTRUCTOR', isActive: true },
          select: { id: true, name: true, email: true },
          orderBy: { name: 'asc' },
        }),
        prisma.user.findMany({
          where: { role: 'TA', isActive: true },
          select: { id: true, name: true, email: true },
          orderBy: { name: 'asc' },
        }),
      ])
    : [[], []]

  return {
    course: {
      ...course,
      createdAt: course.createdAt.toISOString(),
      updatedAt: course.updatedAt.toISOString(),
    },
    user,
    access,
    instructors,
    taUsers,
  }
}

export default function CourseDetailPage() {
  const { course, user, access, instructors, taUsers } = useLoaderData<typeof loader>()
  const revalidator = useRevalidator()
  const { topics, createTopic, deleteTopic } = useCourseTopics(course.id)
  const { enrollments } = useCourseEnrollments(course.id)
  const { materials, uploadMaterial } = useCourseMaterials(course.id)
  const { tas, addTA, removeTA } = useCourseTAs(course.id)
  const { getValidApiKeys } = useApiKeys()
  const [isUploading, setIsUploading] = useState(false)
  const [materialsError, setMaterialsError] = useState<string | null>(null)
  const [materialsSuccess, setMaterialsSuccess] = useState<string | null>(null)

  const handleAssignInstructor = useCallback(async (instructorId: string) => {
    const res = await fetch(`/api/courses/${course.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructorId }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Failed to assign instructor')
    }
    revalidator.revalidate()
  }, [course.id, revalidator])

  const uploadMaterials: UploadMaterial[] = materials.map((m) => ({
    id: m.id,
    title: m.title,
    mimeType: m.mimeType,
    fileSize: m.fileSize,
    status: m.status,
    createdAt: m.createdAt,
    chunkCount: m.chunkCount,
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
      <AppSidebar user={user} />
      <SidebarInset>
        <SiteHeader
          title={course.name}
          breadcrumbs={
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild><Link to="/dashboard">Home</Link></BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink asChild><Link to="/courses">Courses</Link></BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{course.name}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
        />
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
                instructors={instructors}
                taUsers={taUsers}
                isUploading={isUploading}
                materialsError={materialsError}
                materialsSuccess={materialsSuccess}
                onFileSelect={handleFileSelect}
                onCreateTopic={async (name) => { await createTopic(name) }}
                onDeleteTopic={async (id) => { await deleteTopic(id) }}
                onAssignInstructor={handleAssignInstructor}
                onAddTA={addTA}
                onRemoveTA={removeTA}
                courseId={course.id}
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
                courseId={course.id}
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
