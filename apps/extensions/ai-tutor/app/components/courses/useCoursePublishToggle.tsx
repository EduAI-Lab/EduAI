/**
 * @file Publish/unpublish a course behind a confirm, shared by the dashboard,
 * the Courses list and the course banner.
 */
import { useState } from "react";
import { useRevalidator } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@eduai/ui";
import api from "~/lib/api";
import type { Course } from "~/lib/types";
import { courseCode, courseName } from "~/lib/course-display";

/**
 * Publish/unpublish a course behind a confirm. Course publish state is owned by
 * Core; the API proxies the write, then the route's loader re-reads it.
 */
export function useCoursePublishToggle() {
  const revalidator = useRevalidator();
  const [pending, setPending] = useState<Course | null>(null);

  const toggle = async (course: Course) => {
    const label = courseCode(course);
    try {
      const updated = course.isPublished
        ? await api.unpublishCourse(course.id)
        : await api.publishCourse(course.id);
      toast.success(
        updated?.corePublishStale
          ? `Saved ${label}. EduAI hasn't confirmed it back yet.`
          : course.isPublished
            ? `${label} is now hidden from students.`
            : `${label} is now visible to students.`,
      );
      await revalidator.revalidate();
    } catch (error) {
      console.error("Failed to change course publish state", error);
      toast.error(`Could not update ${label}. Try again.`);
    }
  };

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
      title={
        pending ? `${pending.isPublished ? "Unpublish" : "Publish"} "${courseName(pending)}"?` : ""
      }
      description={
        pending?.isPublished
          ? "Students will lose access to this course and everything in it."
          : "Students will be able to see this course. Its modules and lessons stay hidden until you publish them individually."
      }
      confirmLabel={pending?.isPublished ? "Unpublish" : "Publish"}
      variant={pending?.isPublished ? "destructive" : "default"}
      onConfirm={() => {
        if (!pending) return;
        void toggle(pending);
        setPending(null);
      }}
    />
  );

  return { requestToggle: setPending, dialog };
}
