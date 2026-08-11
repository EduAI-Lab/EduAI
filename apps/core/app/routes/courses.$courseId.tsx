import { useState, useCallback } from 'react'
import { Link, redirect, useLoaderData, useRevalidator } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'

import { auth } from '~/lib/auth/server'
import prisma from '~/lib/prisma.server'
import { CoreAppShell } from '~/components/layout/core-app-shell'
import { CourseDetailManagerView } from '~/components/courses/course-detail-manager-view'
import { CourseDetailTaView } from '~/components/courses/course-detail-ta-view'
import { CourseDetailStudentView } from '~/components/courses/course-detail-student-view'
import { useCourseTopics } from '~/hooks/api/use-course-topics'
import { useCourseEnrollments } from '~/hooks/api/use-course-enrollments'
import { useCourseMaterials } from '~/hooks/api/use-course-materials'
import { useCourseTAs } from '~/hooks/api/use-course-tas'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@eduai/ui'
import { CourseSwitcher } from '~/components/layout/course-switcher'
import type { CourseMaterial as UploadMaterial } from '~/components/course-materials-upload'
import type { CourseDetail } from '~/hooks/api/use-course-detail'
import { resolveCourseAccess } from '~/lib/rbac/resolve-course-access.server'
import type { RbacUser } from '~/lib/rbac'
import { courseHasAiConfig } from '~/lib/ai/response-style-tags'

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return redirect('/auth/login')

  const courseId = params.courseId
  if (!courseId) return redirect('/courses')

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      instructor: { select: { id: true, name: true, email: true } },
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
  if (access === 'student' && !course.isPublished) return redirect('/courses?access=unpublished')

  // Reassigning the instructor is ADMIN/UNIT_ADMIN only. Load the instructor
  // list only when usable.
  const canManageStaff = access === 'admin' || access === 'unit'

  // TA/student candidates are no longer preloaded here (#1042) — the platform-wide
  // STUDENT list used to grow unbounded with total user count. The manager view's
  // Candidates are searched on demand through the bounded, paginated users
  // API; do not preload the platform-wide STUDENT list here.
  const instructors = canManageStaff
    ? await prisma.user.findMany({
        where: { role: 'INSTRUCTOR', isActive: true },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      })
    : []

  const isStudent = access === 'student'

  return {
    course: {
      id: course.id,
      code: course.code,
      name: course.name,
      description: course.description,
      term: course.term,
      year: course.year,
      isActive: course.isActive,
      isPublished: course.isPublished,
      ...(isStudent
        ? {
            hasAiConfig: courseHasAiConfig(
              course.responseStyleTags ?? [],
              course.aiInstructions,
            ),
          }
        : { aiInstructions: course.aiInstructions }),
      responseStyleTags: course.responseStyleTags,
      ragTopK: course.ragTopK,
      ragSimilarityThreshold: course.ragSimilarityThreshold,
      instructorId: course.instructorId,
      department: course.department,
      startDate: course.startDate.toISOString(),
      endDate: course.endDate?.toISOString() ?? null,
      externalSource: course.externalSource,
      externalId: course.externalId,
      createdAt: course.createdAt.toISOString(),
      updatedAt: course.updatedAt.toISOString(),
      instructor: course.instructor ?? undefined,
      // TA roster is loaded client-side via useCourseTAs (TA = Enrollment
      // role=TA); the course query no longer includes a CourseTA relation.
    } satisfies CourseDetail,
    user,
    access,
    instructors,
  }
}

export default function CourseDetailPage() {
  const { course, user, access, instructors } =
    useLoaderData<typeof loader>()
  const revalidator = useRevalidator()
  const { topics, createTopic, deleteTopic } = useCourseTopics(course.id)
  const {
    enrollments,
    loading: enrollmentsLoading,
    error: enrollmentsError,
    total: enrollmentsTotal,
    hasMore: hasMoreEnrollments,
    loadingMore: enrollmentsLoadingMore,
    loadMore: loadMoreEnrollments,
    enroll,
    removeEnrollment,
    refetch: refetchEnrollments,
  } = useCourseEnrollments(course.id)
  const {
    materials,
    uploadMaterial,
    deleteMaterial,
    hasMore: hasMoreMaterials,
    loadingMore: materialsLoadingMore,
    loadMore: loadMoreMaterials,
    refetch: refetchMaterials,
  } = useCourseMaterials(course.id)
  const { tas, addTA, removeTA } = useCourseTAs(course.id)
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
    await refetchEnrollments()
  }, [course.id, revalidator, refetchEnrollments])

  const handleEnrollStudent = useCallback(
    async (userId: string) => {
      await enroll(userId, 'STUDENT')
    },
    [enroll],
  )

  const handleRemoveEnrollment = useCallback(
    async (enrollmentId: string) => {
      await removeEnrollment(enrollmentId)
    },
    [removeEnrollment],
  )

  const uploadMaterials: UploadMaterial[] = materials.map((m) => ({
    id: m.id,
    title: m.title,
    mimeType: m.mimeType,
    fileSize: m.fileSize,
    status: m.status,
    createdAt: m.createdAt,
    chunkCount: m.chunkCount,
    uploadedBy: m.uploadedBy ?? null,
    visibleToStudents: m.visibleToStudents,
    availableAt: m.availableAt ?? null,
  }))

  const handleFileSelect = async (file: File) => {
    setIsUploading(true)
    setMaterialsError(null)
    setMaterialsSuccess(null)
    try {
      await uploadMaterial(file)
      setMaterialsSuccess('Material uploaded successfully')
    } catch (e) {
      setMaterialsError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <CoreAppShell
      user={user}
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
              <CourseSwitcher currentCourseId={course.id} currentCourseCode={course.code} currentCourseName={course.name} />
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <div className="flex flex-1 flex-col">
        <div className="px-4 lg:px-6 py-6">
          {access === 'admin' || access === 'unit' || access === 'instructor' ? (
            <CourseDetailManagerView
              course={course}
              access={access}
              topics={topics}
              enrollments={enrollments}
              enrollmentsLoading={enrollmentsLoading}
              enrollmentsError={enrollmentsError}
              enrollmentsTotal={enrollmentsTotal}
              hasMoreEnrollments={hasMoreEnrollments}
              enrollmentsLoadingMore={enrollmentsLoadingMore}
              onLoadMoreEnrollments={loadMoreEnrollments}
              materials={uploadMaterials}
              hasMoreMaterials={hasMoreMaterials}
              materialsLoadingMore={materialsLoadingMore}
              onLoadMoreMaterials={loadMoreMaterials}
              tas={tas}
              instructors={instructors}
              onEnrollStudent={handleEnrollStudent}
              onRemoveEnrollment={handleRemoveEnrollment}
              isUploading={isUploading}
              materialsError={materialsError}
              materialsSuccess={materialsSuccess}
              onFileSelect={handleFileSelect}
              onCreateTopic={async (name) => { await createTopic(name) }}
              onDeleteTopic={async (id) => { await deleteTopic(id) }}
              onAssignInstructor={handleAssignInstructor}
              onAddTA={addTA}
              onRemoveTA={removeTA}
              onRefreshMaterials={refetchMaterials}
              onDeleteMaterial={deleteMaterial}
              courseId={course.id}
              currentUserId={user.id}
              showCanvasMaterialSync={
                access === 'instructor' &&
                course.externalSource === 'canvas' &&
                Boolean(course.externalId)
              }
              onMaterialsRefresh={() => void refetchMaterials()}
            />
          ) : access === 'ta' ? (
            <CourseDetailTaView
              course={course}
              topics={topics}
              materials={uploadMaterials}
              hasMoreMaterials={hasMoreMaterials}
              materialsLoadingMore={materialsLoadingMore}
              onLoadMoreMaterials={loadMoreMaterials}
              isUploading={isUploading}
              materialsError={materialsError}
              materialsSuccess={materialsSuccess}
              onFileSelect={handleFileSelect}
              courseId={course.id}
              currentUserId={user.id}
              onRefreshMaterials={refetchMaterials}
              onDeleteMaterial={deleteMaterial}
              tas={tas}
              onCreateTopic={async (name) => { await createTopic(name) }}
              onDeleteTopic={async (id) => { await deleteTopic(id) }}
            />
          ) : (
            <CourseDetailStudentView
              course={course}
              materials={uploadMaterials}
              hasMoreMaterials={hasMoreMaterials}
              materialsLoadingMore={materialsLoadingMore}
              onLoadMoreMaterials={loadMoreMaterials}
              topics={topics}
              tas={tas}
              isUploading={isUploading}
              materialsError={materialsError}
              materialsSuccess={materialsSuccess}
              onFileSelect={handleFileSelect}
            />
          )}
        </div>
      </div>
    </CoreAppShell>
  )
}
