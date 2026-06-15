import { Button } from '@eduai/ui';

import { ExternalLink } from 'lucide-react';
import { getCoreDashboardUrl } from '@/lib/coreUrl';

type EduAiBackLinkProps = {
  className?: string;
  size?: 'default' | 'sm' | 'lg' | 'icon';
};

/** Cross-app link back to the EduAI Core dashboard. */
export function EduAiBackLink({ className, size = 'sm' }: EduAiBackLinkProps) {
  return (
    <Button variant="outline" size={size} className={className} asChild>
      <a href={getCoreDashboardUrl()}>
        <ExternalLink className="size-4" />
        EduAI
      </a>
    </Button>
  );
}
