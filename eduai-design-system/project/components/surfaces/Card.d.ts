export interface CardProps {
  children: React.ReactNode;
  /** Add lift shadow + translateY on hover */
  hoverable?: boolean;
  style?: React.CSSProperties;
}

export interface CardHeaderProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export interface CardTitleProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export interface CardDescriptionProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export interface CardContentProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export interface CardFooterProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export interface StatCardProps {
  /** Metric label e.g. "Active Students" */
  label: string;
  /** Displayed value e.g. "4,532" */
  value: string | number;
  /** Percentage change (positive or negative number) */
  trend?: number;
  /** Trend description e.g. "vs last month" */
  trendLabel?: string;
  style?: React.CSSProperties;
}
