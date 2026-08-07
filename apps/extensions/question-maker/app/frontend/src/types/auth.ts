export interface User {
  id: string;
  email: string;
  name?: string;
  image?: string;
  role: string;
  isBugReportAdmin?: boolean;
  authorizedUnits?: string[];
}
