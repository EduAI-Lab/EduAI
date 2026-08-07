import { useContext } from 'react';
import { BugReportContext } from './BugReportProvider';

export function useBugReport() {
  const context = useContext(BugReportContext);
  if (!context) {
    throw new Error('useBugReport must be used within a BugReportProvider');
  }
  return context;
}
