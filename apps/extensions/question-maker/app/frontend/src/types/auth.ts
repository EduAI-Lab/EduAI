export interface User {
  id: string;
  email: string;
  name?: string;
  image?: string;
  role: string;
  questionMakerRole?: "TA";
  isBugReportAdmin?: boolean;
  authorizedUnits?: string[];
}
