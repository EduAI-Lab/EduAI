import { ReactNode } from 'react';

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

export type TourStep = {
  /** Step identifier; also used as default `data-tour-id` unless `targetId` is set */
  id: string;
  title: string;
  content: ReactNode;
  placement?: TourPlacement;
  /** Override DOM target when multiple elements share a logical step */
  targetId?: string;
  /** Extra ms to wait after step action before advancing (default 150) */
  advanceDelayMs?: number;
  /** Max ms to poll for the next step's target before advancing anyway */
  waitForTargetMs?: number;
};

export type TourId = 'main' | 'assessmentBuilder';

export type TourConfig = Record<TourId, TourStep[]>;
