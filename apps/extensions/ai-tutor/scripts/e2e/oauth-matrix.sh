#!/usr/bin/env bash
set -euo pipefail

# End-to-end OAuth + role regression matrix for AiTutor.
#
# Requirements:
# - AiTutor server running at http://localhost:4000
# - EduAI server running at http://localhost:5174
# - Seeded EduAI users:
#   - instructor@eduai.local / instructor123
#   - student@eduai.local / student123
#   - admin@eduai.local / admin123
# - Local tools: curl, jq, python3, bun
#
# Notes:
# - This validates the AiTutor <-> EduAI auth and role flows.
# - teach/guide/custom endpoints are validated for auth + request validation.
#   They are not expected to produce a real model response unless a valid
#   user API key is supplied in the request payload.

BASE="http://localhost:4000"
EDUAI="http://localhost:5174"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AITUTOR_SERVER="$REPO_ROOT/server"
EDUAI_ROOT="$(cd "$REPO_ROOT/../EduAICoreLearning" && pwd)"
RUN_ID="$(date +%s)"
TMPDIR="$(mktemp -d)"
REPORT="$TMPDIR/report.txt"
FAILURES=0
IMPORTED_COURSE_ID=""
LOCAL_COURSE_ID=""
TARGET_COURSE_ID=""
EDUAI_FIXTURE_CODE="AITUT${RUN_ID}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

cleanup_db() {
  (
    cd "$AITUTOR_SERVER"
    bun -e '
    import { PrismaClient } from "@prisma/client";
    const prisma = new PrismaClient();
    const runId = process.env.RUN_ID;
    const importedCourseId = process.env.IMPORTED_COURSE_ID ? Number(process.env.IMPORTED_COURSE_ID) : null;
    const localCourseId = process.env.LOCAL_COURSE_ID ? Number(process.env.LOCAL_COURSE_ID) : null;
    const targetCourseId = process.env.TARGET_COURSE_ID ? Number(process.env.TARGET_COURSE_ID) : null;

    const deleteCourseOffering = async (courseId) => {
      if (!courseId || !Number.isFinite(courseId)) return;

      const modules = await prisma.module.findMany({
        where: { courseOfferingId: courseId },
        select: { id: true },
      });
      const moduleIds = modules.map((module) => module.id);

      const lessons = moduleIds.length
        ? await prisma.lesson.findMany({
            where: { moduleId: { in: moduleIds } },
            select: { id: true },
          })
        : [];
      const lessonIds = lessons.map((lesson) => lesson.id);

      const activities = lessonIds.length
        ? await prisma.activity.findMany({
            where: { lessonId: { in: lessonIds } },
            select: { id: true },
          })
        : [];
      const activityIds = activities.map((activity) => activity.id);

      const topics = await prisma.topic.findMany({
        where: { courseOfferingId: courseId },
        select: { id: true },
      });
      const topicIds = topics.map((topic) => topic.id);

      if (activityIds.length) {
        await prisma.activityFeedback.deleteMany({ where: { activityId: { in: activityIds } } });
        await prisma.submission.deleteMany({ where: { activityId: { in: activityIds } } });
        await prisma.activityStudentMetric.deleteMany({ where: { activityId: { in: activityIds } } });
        await prisma.activityAnalytics.deleteMany({ where: { activityId: { in: activityIds } } });
        await prisma.activitySecondaryTopic.deleteMany({ where: { activityId: { in: activityIds } } });
        await prisma.activity.deleteMany({ where: { id: { in: activityIds } } });
      }

      if (lessonIds.length) {
        await prisma.lesson.deleteMany({ where: { id: { in: lessonIds } } });
      }

      if (moduleIds.length) {
        await prisma.module.deleteMany({ where: { id: { in: moduleIds } } });
      }

      if (topicIds.length) {
        await prisma.activitySecondaryTopic.deleteMany({ where: { topicId: { in: topicIds } } });
        await prisma.topic.deleteMany({ where: { id: { in: topicIds } } });
      }

      await prisma.courseEnrollment.deleteMany({ where: { courseOfferingId: courseId } });
      await prisma.courseInstructor.deleteMany({ where: { courseOfferingId: courseId } });
      await prisma.courseOffering.deleteMany({ where: { id: courseId } });
    };

    await deleteCourseOffering(importedCourseId);
    await deleteCourseOffering(localCourseId);
    await deleteCourseOffering(targetCourseId);

    await prisma.promptTemplate.deleteMany({
      where: { name: { startsWith: `Curl Prompt ${runId}` } },
    });

    await prisma.$disconnect();
  ' >/dev/null 2>&1
  ) || true

  if [[ -d "$EDUAI_ROOT" ]]; then
    (
      cd "$EDUAI_ROOT"
      bun -e '
      import { PrismaClient } from "@prisma/client";
      const prisma = new PrismaClient();
      const code = process.env.EDUAI_FIXTURE_CODE;
      const run = async () => {
        const course = await prisma.course.findUnique({
          where: { code },
          select: { id: true },
        });
        if (course) {
          await prisma.courseTopic.deleteMany({ where: { courseId: course.id } });
          await prisma.course.delete({ where: { id: course.id } });
        }
        await prisma.$disconnect();
      };
      run();
    ' >/dev/null 2>&1
    ) || true
  fi
}

cleanup() {
  cleanup_db
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

log() {
  printf '%s\n' "$*" | tee -a "$REPORT"
}

extract_location() {
  python3 - "$1" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
loc = ""
for line in text.splitlines():
    if line.lower().startswith("location:"):
        loc = line.split(":", 1)[1].strip()
        break
print(loc)
PY
}

abs_redirect_url() {
  case "$1" in
    http://*|https://*) printf '%s' "$1" ;;
    /auth/*|/api/auth/oauth2/authorize*) printf '%s%s' "$EDUAI" "$1" ;;
    /*) printf '%s%s' "$BASE" "$1" ;;
    *) printf '%s' "$1" ;;
  esac
}

oauth_login_aitutor() {
  local email="$1"
  local password="$2"
  local callback="$3"
  local jar="$4"
  local start auth_url next_url callback_url
  local provider_jar="${jar}.eduai"

  start=$(curl -s -c "$jar" -b "$jar" -H 'content-type: application/json' \
    -d "{\"providerId\":\"eduai\",\"callbackURL\":\"$callback\",\"disableRedirect\":true}" \
    "$BASE/api/auth/sign-in/oauth2")
  auth_url=$(printf '%s' "$start" | jq -r '.url')

  curl -s -c "$provider_jar" -b "$provider_jar" -H "Origin: $EDUAI" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$password\",\"rememberMe\":false}" \
    "$EDUAI/api/auth/sign-in/email" >/dev/null
  sleep 1

  curl -s -D "$TMPDIR/auth-headers.txt" -o /dev/null -c "$provider_jar" -b "$provider_jar" "$auth_url" >/dev/null
  next_url=$(abs_redirect_url "$(extract_location "$TMPDIR/auth-headers.txt")")
  callback_url="$next_url"

  while [[ "$callback_url" == "$EDUAI"* ]]; do
    if [[ "$callback_url" == *"/auth/consent"* ]]; then
      curl -s -c "$provider_jar" -b "$provider_jar" "$callback_url" >/dev/null
      curl -s -D "$TMPDIR/consent-headers.txt" -o /dev/null -c "$provider_jar" -b "$provider_jar" \
        -H "Origin: $EDUAI" -H "Referer: $callback_url" -H 'Content-Type: application/x-www-form-urlencoded' \
        --data 'accept=true' "$callback_url" >/dev/null
      callback_url="$(extract_location "$TMPDIR/consent-headers.txt")"
    elif [[ "$callback_url" == *"/auth/login"* ]]; then
      # EduAI redirected to its frontend login page, meaning the session
      # cookie was not recognised.  Re-authenticate via the Better Auth API
      # and retry the authorize URL so we get a consent redirect instead.
      curl -s -c "$provider_jar" -b "$provider_jar" -H "Origin: $EDUAI" -H 'Content-Type: application/json' \
        -d "{\"email\":\"$email\",\"password\":\"$password\",\"rememberMe\":false}" \
        "$EDUAI/api/auth/sign-in/email" >/dev/null
      sleep 1
      curl -s -D "$TMPDIR/provider-redirect-headers.txt" -o /dev/null -c "$provider_jar" -b "$provider_jar" "$auth_url" >/dev/null
      callback_url="$(abs_redirect_url "$(extract_location "$TMPDIR/provider-redirect-headers.txt")")"
    else
      curl -s -D "$TMPDIR/provider-redirect-headers.txt" -o /dev/null -c "$provider_jar" -b "$provider_jar" \
        "$callback_url" >/dev/null
      callback_url="$(abs_redirect_url "$(extract_location "$TMPDIR/provider-redirect-headers.txt")")"
    fi
  done

  curl -s -L -c "$jar" -b "$jar" "$callback_url" >/dev/null
  sleep 1
}

request() {
  local jar="$1"
  local method="$2"
  local path="$3"
  local data="${4-}"
  local outfile="$5"
  if [[ -n "$data" ]]; then
    curl -s -o "$outfile" -w '%{http_code}' -c "$jar" -b "$jar" -X "$method" \
      -H 'Content-Type: application/json' -d "$data" "$BASE$path"
  else
    curl -s -o "$outfile" -w '%{http_code}' -c "$jar" -b "$jar" -X "$method" "$BASE$path"
  fi
}

expect_status() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  local outfile="$4"
  if [[ "$actual" == "$expected" ]]; then
    log "PASS $name [$actual]"
  else
    log "FAIL $name expected=$expected actual=$actual body=$(cat "$outfile")"
    FAILURES=$((FAILURES + 1))
  fi
}

need_cmd curl
need_cmd jq
need_cmd python3
need_cmd bun

curl -fsS "$BASE/api/health" >/dev/null
curl -fsS "$EDUAI/api/ai-models" >/dev/null

EDUAI_ADMIN_JAR="$TMPDIR/eduai-admin.cookies"
curl -s -c "$EDUAI_ADMIN_JAR" -b "$EDUAI_ADMIN_JAR" -H "Origin: $EDUAI" -H 'Content-Type: application/json' \
  -d '{"email":"admin@eduai.local","password":"admin123","rememberMe":false}' \
  "$EDUAI/api/auth/sign-in/email" >/dev/null

status=$(curl -s -o "$TMPDIR/eduai-fixture-course.json" -w '%{http_code}' -c "$EDUAI_ADMIN_JAR" -b "$EDUAI_ADMIN_JAR" -X POST \
  -F "name=AiTutor Matrix $RUN_ID" \
  -F "code=$EDUAI_FIXTURE_CODE" \
  -F 'term=Spring' \
  -F 'year=2026' \
  -F 'aiInstructions=AiTutor regression fixture' \
  "$EDUAI/api/courses")
expect_status 'seed EduAI fixture course' 201 "$status" "$TMPDIR/eduai-fixture-course.json"
EXTERNAL_COURSE_ID=$(jq -r '.id' "$TMPDIR/eduai-fixture-course.json")

# EduAI's GET /api/courses is user-scoped: professors only see courses
# they own.  Course creation always sets professorId = authenticated user
# (the admin).  Reassign ownership to instructor@eduai.local via Prisma
# so that the professor's OAuth token can discover and import the fixture.
(
  cd "$EDUAI_ROOT"
  EXTERNAL_COURSE_ID="$EXTERNAL_COURSE_ID" bun -e '
  import { PrismaClient } from "@prisma/client";
  const prisma = new PrismaClient();
  const courseId = process.env.EXTERNAL_COURSE_ID;
  const instructor = await prisma.user.findFirst({ where: { email: "instructor@eduai.local" } });
  if (!instructor) { console.error("instructor@eduai.local not found"); process.exit(1); }
  await prisma.course.update({ where: { id: courseId }, data: { professorId: instructor.id } });
  await prisma.$disconnect();
  '
)
log "INFO reassigned fixture course to instructor@eduai.local"

status=$(curl -s -o "$TMPDIR/eduai-fixture-topic-a.json" -w '%{http_code}' -c "$EDUAI_ADMIN_JAR" -b "$EDUAI_ADMIN_JAR" \
  -X POST -H 'Content-Type: application/json' -d '{"name":"Regression Topic 1"}' \
  "$EDUAI/api/courses/$EXTERNAL_COURSE_ID/topics")
expect_status 'seed EduAI fixture topic A' 201 "$status" "$TMPDIR/eduai-fixture-topic-a.json"
status=$(curl -s -o "$TMPDIR/eduai-fixture-topic-b.json" -w '%{http_code}' -c "$EDUAI_ADMIN_JAR" -b "$EDUAI_ADMIN_JAR" \
  -X POST -H 'Content-Type: application/json' -d '{"name":"Regression Topic 2"}' \
  "$EDUAI/api/courses/$EXTERNAL_COURSE_ID/topics")
expect_status 'seed EduAI fixture topic B' 201 "$status" "$TMPDIR/eduai-fixture-topic-b.json"

PROF_JAR="$TMPDIR/prof.cookies"
STUDENT_JAR="$TMPDIR/student.cookies"
ADMIN_JAR="$TMPDIR/admin.cookies"

oauth_login_aitutor 'admin@eduai.local' 'admin123' 'http://localhost:5173/admin' "$ADMIN_JAR"
oauth_login_aitutor 'instructor@eduai.local' 'instructor123' 'http://localhost:5173/instructor' "$PROF_JAR"
oauth_login_aitutor 'student@eduai.local' 'student123' 'http://localhost:5173/student' "$STUDENT_JAR"

status=$(request "$PROF_JAR" GET '/api/me' '' "$TMPDIR/prof-me.json")
expect_status 'prof me' 200 "$status" "$TMPDIR/prof-me.json"
status=$(request "$STUDENT_JAR" GET '/api/me' '' "$TMPDIR/student-me.json")
expect_status 'student me' 200 "$status" "$TMPDIR/student-me.json"
status=$(request "$ADMIN_JAR" GET '/api/me' '' "$TMPDIR/admin-me.json")
expect_status 'admin me' 200 "$status" "$TMPDIR/admin-me.json"

status=$(request "$PROF_JAR" GET '/api/suggested-prompts' '' "$TMPDIR/prof-suggested.json")
expect_status 'prof suggested-prompts' 200 "$status" "$TMPDIR/prof-suggested.json"
status=$(request "$STUDENT_JAR" GET '/api/suggested-prompts' '' "$TMPDIR/student-suggested.json")
expect_status 'student suggested-prompts' 200 "$status" "$TMPDIR/student-suggested.json"

status=$(request "$PROF_JAR" GET '/api/ai-models' '' "$TMPDIR/prof-models.json")
expect_status 'prof ai-models' 200 "$status" "$TMPDIR/prof-models.json"
status=$(request "$STUDENT_JAR" GET '/api/ai-models' '' "$TMPDIR/student-models.json")
expect_status 'student ai-models' 200 "$status" "$TMPDIR/student-models.json"
status=$(request "$ADMIN_JAR" GET '/api/ai-models' '' "$TMPDIR/admin-models.json")
expect_status 'admin ai-models' 200 "$status" "$TMPDIR/admin-models.json"
status=$(request "$PROF_JAR" POST '/api/ai-models/validate-key' '{"provider":"openai"}' "$TMPDIR/validate-key.json")
expect_status 'validate-key missing apiKey' 400 "$status" "$TMPDIR/validate-key.json"

status=$(request "$PROF_JAR" GET '/api/eduai/courses' '' "$TMPDIR/eduai-courses.json")
expect_status 'prof eduai courses' 200 "$status" "$TMPDIR/eduai-courses.json"
MATCHED_EXTERNAL=$(jq -r --arg id "$EXTERNAL_COURSE_ID" '.[] | select(.id == $id) | .id' "$TMPDIR/eduai-courses.json")
if [[ "$MATCHED_EXTERNAL" == "$EXTERNAL_COURSE_ID" ]]; then
  log 'PASS prof eduai courses contains seeded fixture'
else
  log "FAIL prof eduai courses missing seeded fixture id=$EXTERNAL_COURSE_ID"
  FAILURES=$((FAILURES + 1))
fi
status=$(request "$STUDENT_JAR" GET '/api/eduai/courses' '' "$TMPDIR/student-eduai-courses.json")
expect_status 'student eduai courses forbidden' 403 "$status" "$TMPDIR/student-eduai-courses.json"
status=$(request "$ADMIN_JAR" GET '/api/eduai/courses' '' "$TMPDIR/admin-eduai-courses.json")
expect_status 'admin eduai courses forbidden' 403 "$status" "$TMPDIR/admin-eduai-courses.json"

status=$(request "$PROF_JAR" POST '/api/courses/import-external' "{\"externalCourseId\":\"$EXTERNAL_COURSE_ID\"}" "$TMPDIR/imported-course.json")
expect_status 'prof import external course' 201 "$status" "$TMPDIR/imported-course.json"
IMPORTED_COURSE_ID=$(jq -r '.id' "$TMPDIR/imported-course.json")
status=$(request "$PROF_JAR" GET "/api/courses/$IMPORTED_COURSE_ID" '' "$TMPDIR/imported-course-get.json")
expect_status 'prof get imported course' 200 "$status" "$TMPDIR/imported-course-get.json"
status=$(request "$PROF_JAR" GET "/api/courses/$IMPORTED_COURSE_ID/topics" '' "$TMPDIR/imported-topics.json")
expect_status 'prof get imported topics' 200 "$status" "$TMPDIR/imported-topics.json"
status=$(request "$PROF_JAR" POST "/api/courses/$IMPORTED_COURSE_ID/topics/sync" '' "$TMPDIR/imported-sync.json")
expect_status 'prof sync imported topics' 200 "$status" "$TMPDIR/imported-sync.json"
status=$(request "$PROF_JAR" POST "/api/courses/$IMPORTED_COURSE_ID/topics" '{"name":"Should Fail"}' "$TMPDIR/imported-topic-create.json")
expect_status 'prof create imported topic forbidden' 403 "$status" "$TMPDIR/imported-topic-create.json"

status=$(request "$PROF_JAR" GET '/api/prompts' '' "$TMPDIR/prompts-get.json")
expect_status 'prof get prompts' 200 "$status" "$TMPDIR/prompts-get.json"
status=$(request "$PROF_JAR" POST '/api/prompts' "{\"name\":\"Curl Prompt $RUN_ID\",\"systemPrompt\":\"You are a regression test prompt.\"}" "$TMPDIR/prompts-post.json")
expect_status 'prof create prompt' 201 "$status" "$TMPDIR/prompts-post.json"
status=$(request "$STUDENT_JAR" GET '/api/prompts' '' "$TMPDIR/student-prompts.json")
expect_status 'student prompts forbidden' 403 "$status" "$TMPDIR/student-prompts.json"

status=$(request "$PROF_JAR" POST '/api/courses' "{\"title\":\"Curl OAuth Course $RUN_ID\",\"description\":\"Regression course\"}" "$TMPDIR/course-create.json")
expect_status 'prof create local course' 201 "$status" "$TMPDIR/course-create.json"
LOCAL_COURSE_ID=$(jq -r '.id' "$TMPDIR/course-create.json")
status=$(request "$PROF_JAR" PATCH "/api/courses/$LOCAL_COURSE_ID" '{"description":"Regression course updated"}' "$TMPDIR/course-patch.json")
expect_status 'prof patch local course' 200 "$status" "$TMPDIR/course-patch.json"
status=$(request "$PROF_JAR" GET '/api/courses' '' "$TMPDIR/prof-courses.json")
expect_status 'prof list courses' 200 "$status" "$TMPDIR/prof-courses.json"
status=$(request "$ADMIN_JAR" GET '/api/courses' '' "$TMPDIR/admin-courses-denied.json")
expect_status 'admin list courses forbidden' 403 "$status" "$TMPDIR/admin-courses-denied.json"

status=$(request "$PROF_JAR" POST "/api/courses/$LOCAL_COURSE_ID/topics" '{"name":"Topic A"}' "$TMPDIR/topic-a.json")
expect_status 'prof create topic A' 201 "$status" "$TMPDIR/topic-a.json"
TOPIC_A=$(jq -r '.id' "$TMPDIR/topic-a.json")
status=$(request "$PROF_JAR" POST "/api/courses/$LOCAL_COURSE_ID/topics" '{"name":"Topic B"}' "$TMPDIR/topic-b.json")
expect_status 'prof create topic B' 201 "$status" "$TMPDIR/topic-b.json"
TOPIC_B=$(jq -r '.id' "$TMPDIR/topic-b.json")
status=$(request "$PROF_JAR" GET "/api/courses/$LOCAL_COURSE_ID/topics" '' "$TMPDIR/course-topics.json")
expect_status 'prof list local topics' 200 "$status" "$TMPDIR/course-topics.json"

status=$(request "$PROF_JAR" POST "/api/courses/$LOCAL_COURSE_ID/modules" '{"title":"Module 1","description":"M1","position":0}' "$TMPDIR/module-create.json")
expect_status 'prof create module' 201 "$status" "$TMPDIR/module-create.json"
MODULE_ID=$(jq -r '.id' "$TMPDIR/module-create.json")
status=$(request "$PROF_JAR" GET "/api/courses/$LOCAL_COURSE_ID/modules" '' "$TMPDIR/modules-list.json")
expect_status 'prof list modules' 200 "$status" "$TMPDIR/modules-list.json"
status=$(request "$PROF_JAR" GET "/api/modules/$MODULE_ID" '' "$TMPDIR/module-get.json")
expect_status 'prof get module' 200 "$status" "$TMPDIR/module-get.json"

status=$(request "$PROF_JAR" POST "/api/modules/$MODULE_ID/lessons" '{"title":"Lesson 1","contentMd":"Hello","position":0}' "$TMPDIR/lesson-create.json")
expect_status 'prof create lesson' 201 "$status" "$TMPDIR/lesson-create.json"
LESSON_ID=$(jq -r '.id' "$TMPDIR/lesson-create.json")
status=$(request "$PROF_JAR" GET "/api/modules/$MODULE_ID/lessons" '' "$TMPDIR/lessons-list.json")
expect_status 'prof list lessons' 200 "$status" "$TMPDIR/lessons-list.json"
status=$(request "$PROF_JAR" GET "/api/lessons/$LESSON_ID" '' "$TMPDIR/lesson-get.json")
expect_status 'prof get lesson' 200 "$status" "$TMPDIR/lesson-get.json"

status=$(request "$PROF_JAR" PATCH "/api/courses/$LOCAL_COURSE_ID/publish" '' "$TMPDIR/course-publish.json")
expect_status 'prof publish course' 200 "$status" "$TMPDIR/course-publish.json"
status=$(request "$PROF_JAR" PATCH "/api/modules/$MODULE_ID/publish" '' "$TMPDIR/module-publish.json")
expect_status 'prof publish module' 200 "$status" "$TMPDIR/module-publish.json"
status=$(request "$PROF_JAR" PATCH "/api/lessons/$LESSON_ID/publish" '' "$TMPDIR/lesson-publish.json")
expect_status 'prof publish lesson' 200 "$status" "$TMPDIR/lesson-publish.json"

ACTIVITY_PAYLOAD=$(jq -cn --argjson main "$TOPIC_A" --argjson secondary "$TOPIC_B" '{title:"Activity 1",question:"2 + 2 = ?",type:"MCQ",options:["4","5"],answer:0,hints:["Add two and two"],instructionsMd:"Pick one.",mainTopicId:$main,secondaryTopicIds:[$secondary],enableTeachMode:true,enableGuideMode:true,enableCustomMode:true,customPromptTitle:"Custom",customPrompt:"Use custom guidance."}')
status=$(request "$PROF_JAR" POST "/api/lessons/$LESSON_ID/activities" "$ACTIVITY_PAYLOAD" "$TMPDIR/activity-create.json")
expect_status 'prof create activity' 201 "$status" "$TMPDIR/activity-create.json"
ACTIVITY_ID=$(jq -r '.id' "$TMPDIR/activity-create.json")
status=$(request "$PROF_JAR" GET "/api/lessons/$LESSON_ID/activities" '' "$TMPDIR/activities-list.json")
expect_status 'prof list activities' 200 "$status" "$TMPDIR/activities-list.json"
ACTIVITY_PATCH=$(jq -cn --argjson main "$TOPIC_A" --argjson secondary "$TOPIC_B" '{title:"Activity 1 updated",question:"3 + 3 = ?",options:["6","7"],answer:0,mainTopicId:$main,secondaryTopicIds:[$secondary],enableTeachMode:true,enableGuideMode:true,enableCustomMode:true,customPromptTitle:"Custom",customPrompt:"Use custom guidance updated."}')
status=$(request "$PROF_JAR" PATCH "/api/activities/$ACTIVITY_ID" "$ACTIVITY_PATCH" "$TMPDIR/activity-patch.json")
expect_status 'prof patch activity' 200 "$status" "$TMPDIR/activity-patch.json"
status=$(request "$PROF_JAR" POST "/api/activities/$ACTIVITY_ID/teach" '{"knowledgeLevel":"beginner","message":"help"}' "$TMPDIR/teach-invalid.json")
expect_status 'teach invalid payload without apiKey' 400 "$status" "$TMPDIR/teach-invalid.json"
status=$(request "$PROF_JAR" POST "/api/activities/$ACTIVITY_ID/guide" '{"knowledgeLevel":"beginner","message":"help"}' "$TMPDIR/guide-invalid.json")
expect_status 'guide invalid payload without apiKey' 400 "$status" "$TMPDIR/guide-invalid.json"
status=$(request "$PROF_JAR" POST "/api/activities/$ACTIVITY_ID/custom" '{"knowledgeLevel":"beginner","message":"help"}' "$TMPDIR/custom-invalid.json")
expect_status 'custom invalid payload without apiKey' 400 "$status" "$TMPDIR/custom-invalid.json"
status=$(request "$PROF_JAR" POST "/api/courses/$LOCAL_COURSE_ID/topics/remap" "{\"mappings\":[{\"fromTopicId\":$TOPIC_B,\"toTopicId\":$TOPIC_A}]}" "$TMPDIR/topics-remap.json")
expect_status 'prof remap topics' 200 "$status" "$TMPDIR/topics-remap.json"

status=$(request "$PROF_JAR" POST '/api/courses' "{\"title\":\"Curl Target Course $RUN_ID\",\"description\":\"Target course\"}" "$TMPDIR/target-course.json")
expect_status 'prof create target course' 201 "$status" "$TMPDIR/target-course.json"
TARGET_COURSE_ID=$(jq -r '.id' "$TMPDIR/target-course.json")
status=$(request "$PROF_JAR" POST "/api/courses/$TARGET_COURSE_ID/import" "{\"sourceCourseId\":$LOCAL_COURSE_ID,\"moduleIds\":[$MODULE_ID]}" "$TMPDIR/course-import.json")
expect_status 'prof import module into target course' 200 "$status" "$TMPDIR/course-import.json"

status=$(request "$ADMIN_JAR" GET '/api/admin/users' '' "$TMPDIR/admin-users.json")
expect_status 'admin users' 200 "$status" "$TMPDIR/admin-users.json"
STUDENT_USER_ID=$(jq -r '.[] | select(.email=="student@eduai.local") | .id' "$TMPDIR/admin-users.json")
status=$(request "$ADMIN_JAR" GET '/api/admin/courses' '' "$TMPDIR/admin-courses.json")
expect_status 'admin courses' 200 "$status" "$TMPDIR/admin-courses.json"
status=$(request "$ADMIN_JAR" GET "/api/admin/courses/$LOCAL_COURSE_ID/enrollments" '' "$TMPDIR/admin-enrollments-before.json")
expect_status 'admin get enrollments' 200 "$status" "$TMPDIR/admin-enrollments-before.json"
status=$(request "$ADMIN_JAR" POST "/api/admin/courses/$LOCAL_COURSE_ID/enrollments" "{\"userId\":\"$STUDENT_USER_ID\"}" "$TMPDIR/admin-enroll.json")
expect_status 'admin enroll student' 201 "$status" "$TMPDIR/admin-enroll.json"
status=$(request "$ADMIN_JAR" GET '/api/admin/settings/eduai-api-key' '' "$TMPDIR/admin-key-get.json")
expect_status 'admin get eduai api key status' 200 "$status" "$TMPDIR/admin-key-get.json"
status=$(request "$ADMIN_JAR" PUT '/api/admin/settings/eduai-api-key' '{"apiKey":"temp-admin-key"}' "$TMPDIR/admin-key-put.json")
expect_status 'admin put eduai api key status' 200 "$status" "$TMPDIR/admin-key-put.json"
status=$(request "$ADMIN_JAR" DELETE '/api/admin/settings/eduai-api-key' '' "$TMPDIR/admin-key-delete.json")
expect_status 'admin delete eduai api key status' 200 "$status" "$TMPDIR/admin-key-delete.json"
status=$(request "$ADMIN_JAR" GET '/api/admin/settings/ai-model-policy' '' "$TMPDIR/ai-policy-get.json")
expect_status 'admin get ai-model policy' 200 "$status" "$TMPDIR/ai-policy-get.json"
FIRST_MODEL_ID=$(jq -r '.availableModels[0].modelId // empty' "$TMPDIR/ai-policy-get.json")
if [[ -n "$FIRST_MODEL_ID" ]]; then
  status=$(request "$ADMIN_JAR" PUT '/api/admin/settings/ai-model-policy' "{\"allowedTutorModelIds\":[\"$FIRST_MODEL_ID\"]}" "$TMPDIR/ai-policy-put.json")
  expect_status 'admin put ai-model policy' 200 "$status" "$TMPDIR/ai-policy-put.json"
fi
status=$(request "$ADMIN_JAR" PATCH "/api/admin/users/$STUDENT_USER_ID/role" '{"role":"PROFESSOR"}' "$TMPDIR/admin-role-patch.json")
expect_status 'admin patch role gone' 410 "$status" "$TMPDIR/admin-role-patch.json"

status=$(request "$STUDENT_JAR" GET '/api/courses' '' "$TMPDIR/student-courses.json")
expect_status 'student list courses' 200 "$status" "$TMPDIR/student-courses.json"
status=$(request "$STUDENT_JAR" GET "/api/courses/$LOCAL_COURSE_ID" '' "$TMPDIR/student-course-get.json")
expect_status 'student get course' 200 "$status" "$TMPDIR/student-course-get.json"
status=$(request "$STUDENT_JAR" GET "/api/courses/$LOCAL_COURSE_ID/topics" '' "$TMPDIR/student-topics.json")
expect_status 'student get topics' 200 "$status" "$TMPDIR/student-topics.json"
status=$(request "$STUDENT_JAR" GET "/api/courses/$LOCAL_COURSE_ID/modules" '' "$TMPDIR/student-modules.json")
expect_status 'student list modules' 200 "$status" "$TMPDIR/student-modules.json"
status=$(request "$STUDENT_JAR" GET "/api/modules/$MODULE_ID" '' "$TMPDIR/student-module.json")
expect_status 'student get module' 200 "$status" "$TMPDIR/student-module.json"
status=$(request "$STUDENT_JAR" GET "/api/modules/$MODULE_ID/lessons" '' "$TMPDIR/student-lessons.json")
expect_status 'student list lessons' 200 "$status" "$TMPDIR/student-lessons.json"
status=$(request "$STUDENT_JAR" GET "/api/lessons/$LESSON_ID" '' "$TMPDIR/student-lesson.json")
expect_status 'student get lesson' 200 "$status" "$TMPDIR/student-lesson.json"
status=$(request "$STUDENT_JAR" GET "/api/lessons/$LESSON_ID/activities" '' "$TMPDIR/student-activities.json")
expect_status 'student list activities' 200 "$status" "$TMPDIR/student-activities.json"
status=$(request "$STUDENT_JAR" POST "/api/questions/$ACTIVITY_ID/answer" '{"answerOption":0}' "$TMPDIR/student-answer.json")
expect_status 'student answer MCQ' 200 "$status" "$TMPDIR/student-answer.json"
ANSWER_CORRECT=$(jq -r '.isCorrect' "$TMPDIR/student-answer.json")
if [[ "$ANSWER_CORRECT" == "true" ]]; then
  log 'PASS student answer correctness true'
else
  log "FAIL student answer correctness expected=true actual=$ANSWER_CORRECT body=$(cat "$TMPDIR/student-answer.json")"
  FAILURES=$((FAILURES + 1))
fi
status=$(request "$STUDENT_JAR" POST "/api/activities/$ACTIVITY_ID/feedback" '{"rating":5,"note":"helpful"}' "$TMPDIR/student-feedback.json")
expect_status 'student feedback' 201 "$status" "$TMPDIR/student-feedback.json"
status=$(request "$STUDENT_JAR" POST "/api/activities/$ACTIVITY_ID/teach" '{"knowledgeLevel":"beginner","message":"help"}' "$TMPDIR/student-teach-invalid.json")
expect_status 'student teach invalid payload' 400 "$status" "$TMPDIR/student-teach-invalid.json"
status=$(request "$STUDENT_JAR" GET '/api/admin/users' '' "$TMPDIR/student-admin-users.json")
expect_status 'student admin users forbidden' 403 "$status" "$TMPDIR/student-admin-users.json"

status=$(request "$PROF_JAR" DELETE "/api/activities/$ACTIVITY_ID" '' "$TMPDIR/activity-delete.json")
expect_status 'prof delete activity' 200 "$status" "$TMPDIR/activity-delete.json"
status=$(request "$PROF_JAR" PATCH "/api/lessons/$LESSON_ID/unpublish" '' "$TMPDIR/lesson-unpublish.json")
expect_status 'prof unpublish lesson' 200 "$status" "$TMPDIR/lesson-unpublish.json"
status=$(request "$PROF_JAR" PATCH "/api/modules/$MODULE_ID/unpublish" '' "$TMPDIR/module-unpublish.json")
expect_status 'prof unpublish module' 200 "$status" "$TMPDIR/module-unpublish.json"
status=$(request "$PROF_JAR" PATCH "/api/courses/$LOCAL_COURSE_ID/unpublish" '' "$TMPDIR/course-unpublish.json")
expect_status 'prof unpublish course' 200 "$status" "$TMPDIR/course-unpublish.json"
status=$(request "$ADMIN_JAR" DELETE "/api/admin/courses/$LOCAL_COURSE_ID/enrollments/$STUDENT_USER_ID" '' "$TMPDIR/admin-enroll-delete.json")
expect_status 'admin unenroll student' 200 "$status" "$TMPDIR/admin-enroll-delete.json"

log "AiTutor matrix complete failures=$FAILURES"
cat "$REPORT"
exit "$FAILURES"
