export type Topic = {
  id: string
  name: string
  description: string | null
  order: number
  createdAt: string | Date
  updatedAt: string | Date
  categoryId: string
}

export type CourseCategory = {
  id: string
  name: string
  description: string | null
  courseId: string
  topics: Topic[]
}
