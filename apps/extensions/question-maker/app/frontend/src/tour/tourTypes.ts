import { ReactNode } from 'react';

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

export type TourStep = {
  /** Matches a `data-tour-id` attribute in the DOM */
  id: string;
  title: string;
  content: ReactNode;
  placement?: TourPlacement;
};

export type TourId = 'main' | 'assessmentBuilder';

export type TourConfig = Record<TourId, TourStep[]>;
