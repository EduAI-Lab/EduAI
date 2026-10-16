export interface MaterialStatusBreakdown {
  ready: number;
  processing: number;
  failed: number;
}

export interface UserRoleBreakdown {
  students: number;
  instructors: number;
  admins: number;
  other: number;
}

export interface DashboardStats {
  chatCount: number;
  chatCountWeek: number;
  materialCount: number;
  studentCount: number;
  instructorCount: number;
  totalUsers: number;
  activeCourseCount: number;
  /**
   * Topics a student can explore: accepted topics in the published courses they
   * are enrolled in (#1937 learner view). STUDENT platform role only (#1962).
   */
  topicCount?: number;
  /** Material processing-status split, scoped to the same courses as materialCount. */
  materialsByStatus?: MaterialStatusBreakdown;
  /** Platform user distribution by role — populated for ADMIN / UNIT_ADMIN only. */
  usersByRole?: UserRoleBreakdown;
}
