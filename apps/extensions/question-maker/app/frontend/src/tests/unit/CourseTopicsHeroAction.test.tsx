/**
 * Unit tests for the QM CourseTopicsHeroAction adapter (#1544). Verifies the
 * shared component receives the right callbacks and that they wire into
 * courseService + toast correctly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const { courseService, toastFn } = vi.hoisted(() => {
  const toast = vi.fn() as any;
  toast.error = vi.fn();
  return {
    courseService: { createTopic: vi.fn() },
    toastFn: toast,
  };
});

vi.mock('sonner', () => ({ toast: toastFn }));
vi.mock('@/services/courseService', () => ({ courseService }));

let lastProps: any;
vi.mock('@eduai/ui', () => ({
  CourseTopicsHeroAction: (props: any) => {
    lastProps = props;
    return <div>hero-action</div>;
  },
}));

import { CourseTopicsHeroAction } from '@/pages/course-detail/CourseTopicsHeroAction';

afterEach(cleanup);

describe('CourseTopicsHeroAction', () => {
  it('passes canManage/isLinked through to the shared component', () => {
    const onTopicsChange = vi.fn();
    render(
      <CourseTopicsHeroAction
        courseId={5}
        isLinked
        canManage={false}
        onTopicsChange={onTopicsChange}
      />,
    );
    expect(lastProps.isLinked).toBe(true);
    expect(lastProps.canManage).toBe(false);
  });

  it('creates a topic via courseService and calls onTopicsChange', async () => {
    const onTopicsChange = vi.fn();
    courseService.createTopic.mockResolvedValue(undefined);
    render(
      <CourseTopicsHeroAction
        courseId={5}
        isLinked={false}
        canManage
        onTopicsChange={onTopicsChange}
      />,
    );
    await lastProps.onCreateTopic('New Topic');
    expect(courseService.createTopic).toHaveBeenCalledWith(5, 'New Topic');
    expect(onTopicsChange).toHaveBeenCalled();
  });

  it('shows a success toast on create success', () => {
    render(
      <CourseTopicsHeroAction courseId={1} isLinked={false} canManage onTopicsChange={vi.fn()} />,
    );
    lastProps.onCreateSuccess('Topic A');
    expect(toastFn).toHaveBeenCalledWith(
      'Topic created',
      expect.objectContaining({ description: expect.stringContaining('Topic A') }),
    );
  });

  it('shows an error toast on create error', () => {
    render(
      <CourseTopicsHeroAction courseId={1} isLinked={false} canManage onTopicsChange={vi.fn()} />,
    );
    lastProps.onCreateError(new Error('nope'));
    expect(toastFn.error).toHaveBeenCalledWith('Error', expect.any(Object));
  });

  it('shows a validation error toast', () => {
    render(
      <CourseTopicsHeroAction courseId={1} isLinked={false} canManage onTopicsChange={vi.fn()} />,
    );
    lastProps.onCreateValidationError('Name is required');
    expect(toastFn.error).toHaveBeenCalledWith(
      'Error',
      expect.objectContaining({ description: 'Name is required' }),
    );
  });
});
