import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CourseTopicsState } from '~/hooks/useCourseTopics';
import type { Course } from '~/lib/types';

const { mockSharedComponent } = vi.hoisted(() => ({
  mockSharedComponent: vi.fn((props: Record<string, unknown>) => (
    <div data-testid="shared-hero-action">
      canManage={String(props.canManage)}, isLinked={String(props.isLinked)}
    </div>
  )),
}));

vi.mock('@eduai/ui', () => ({
  CourseTopicsHeroAction: mockSharedComponent,
}));

let mockPerms: { canManageTopics: boolean } = { canManageTopics: true };
vi.mock('~/hooks/useAtPermissions', () => ({
  useAtPermissions: () => mockPerms,
}));

import { CourseTopicsHeroAction } from '~/components/courses/CourseTopicsHeroAction';

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: 1,
    coreOfferingId: null,
    title: 'Intro to CS',
    isPublished: true,
    ...overrides,
  };
}

function topicsState(overrides: Partial<CourseTopicsState> = {}): CourseTopicsState {
  return {
    topics: [],
    total: 0,
    loading: false,
    error: null,
    refresh: vi.fn(),
    createTopic: vi.fn(),
    loadMore: vi.fn().mockResolvedValue(false),
    loadingMore: false,
    ...overrides,
  };
}

describe('CourseTopicsHeroAction (ai-tutor adapter)', () => {
  it('passes canManage from useAtPermissions and isLinked=false for locally-authored courses', () => {
    mockPerms = { canManageTopics: true };
    render(<CourseTopicsHeroAction course={course({ coreOfferingId: null })} courseTopics={topicsState()} />);

    const props = mockSharedComponent.mock.calls.at(-1)![0];
    expect(props.canManage).toBe(true);
    expect(props.isLinked).toBe(false);
    expect(typeof props.onCreateTopic).toBe('function');
    expect(typeof props.onCreateError).toBe('function');
  });

  it('marks isLinked=true for EduAI-sourced courses (coreOfferingId set)', () => {
    mockPerms = { canManageTopics: true };
    render(
      <CourseTopicsHeroAction
        course={course({ coreOfferingId: 'core-1' })}
        courseTopics={topicsState()}
      />,
    );

    const props = mockSharedComponent.mock.calls.at(-1)![0];
    expect(props.isLinked).toBe(true);
  });

  it('passes canManage=false when the user cannot manage topics', () => {
    mockPerms = { canManageTopics: false };
    render(<CourseTopicsHeroAction course={course()} courseTopics={topicsState()} />);

    const props = mockSharedComponent.mock.calls.at(-1)![0];
    expect(props.canManage).toBe(false);
  });

  it('onCreateTopic delegates to the shared courseTopics.createTopic', async () => {
    const createTopic = vi.fn().mockResolvedValue({ id: 1, name: 'Recursion' });
    mockPerms = { canManageTopics: true };
    render(
      <CourseTopicsHeroAction course={course()} courseTopics={topicsState({ createTopic })} />,
    );

    const props = mockSharedComponent.mock.calls.at(-1)![0];
    await props.onCreateTopic('Recursion');
    expect(createTopic).toHaveBeenCalledWith('Recursion');
  });

  it('onCreateError logs the failure', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPerms = { canManageTopics: true };
    render(<CourseTopicsHeroAction course={course()} courseTopics={topicsState()} />);

    const props = mockSharedComponent.mock.calls.at(-1)![0];
    const err = new Error('boom');
    props.onCreateError(err);
    expect(errorSpy).toHaveBeenCalledWith('Failed to create topic', err);
    errorSpy.mockRestore();
  });

  it('renders the shared component', () => {
    mockPerms = { canManageTopics: true };
    render(<CourseTopicsHeroAction course={course()} courseTopics={topicsState()} />);
    expect(screen.getByTestId('shared-hero-action')).toBeInTheDocument();
  });
});
