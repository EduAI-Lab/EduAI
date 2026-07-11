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
  /** Material processing-status split, scoped to the same courses as materialCount. */
  materialsByStatus?: MaterialStatusBreakdown;
  /** Platform user distribution by role — populated for ADMIN / UNIT_ADMIN only. */
  usersByRole?: UserRoleBreakdown;
}
