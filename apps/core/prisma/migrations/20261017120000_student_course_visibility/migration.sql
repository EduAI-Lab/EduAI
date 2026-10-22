-- #2002: a course may share its files with students. Off, as since #1962.
ALTER TABLE "courses" ADD COLUMN "studentFilesVisible" BOOLEAN NOT NULL DEFAULT false;

-- #2002: instructors choose which approved topics students are shown. Every
-- existing topic stays shown.
ALTER TABLE "course_topics" ADD COLUMN "visibleToStudents" BOOLEAN NOT NULL DEFAULT true;
