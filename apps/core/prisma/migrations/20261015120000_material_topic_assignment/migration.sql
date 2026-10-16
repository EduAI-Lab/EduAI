-- #1965: instructors choose a material's topics; auto-matching leaves those alone.
ALTER TABLE "course_materials" ADD COLUMN "topicsSetManuallyAt" TIMESTAMP(3);

-- Order of a topic among one material's topics; the lowest is the main topic.
ALTER TABLE "course_topic_sources" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
