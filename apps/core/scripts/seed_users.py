#!/usr/bin/env python3
"""
Seed local Canvas LMS with teachers, courses, and students (EduAI dev/testing).

1. Copy this file anywhere (e.g. a temp folder).
2. Paste your admin API token into ADMIN_TOKEN below.
3. Run:  python seed_local_canvas.py

Reset (default on): deletes all courses and non-admin users, then re-seeds.
  python seed_local_canvas.py --no-reset   # upsert only, no wipe
  python seed_local_canvas.py --reset-only # wipe only, no seed

Admin token: log in as site admin → Account → Settings → New Access Token.
Do not commit this file with a real token in git.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

# ========== CONFIG — edit these, then run the script ==========
CANVAS_BASE_URL = "http://localhost:8080"  # match browser / canvasUrl (8080 if Core uses 3000)
ADMIN_TOKEN = "YOUR-TOKEN"  # paste admin access token here, e.g. "1234~abcdef..."
USER_PASSWORD = "password123"  # password assigned to all seeded teacher/student logins
RESET_BEFORE_SEED = True  # delete courses + non-admin users before seeding
# ==============================================================

TEACHERS = [
    {"name": "Alex Instructor", "email": "prof1@example.com"},
    {"name": "Jordan Instructor", "email": "prof2@example.com"},
    {"name": "Morgan Instructor", "email": "prof3@example.com"},
    {"name": "Sam Instructor", "email": "prof4@example.com"},
]

STUDENTS = [
    {"name": "Student One", "email": "student1@example.com", "sis_user_id": "student_1"},
    {"name": "Student Two", "email": "student2@example.com", "sis_user_id": "student_2"},
    {"name": "Student Three", "email": "student3@example.com", "sis_user_id": "student_3"},
    {"name": "Student Four", "email": "student4@example.com", "sis_user_id": "student_4"},
    {"name": "Student Five", "email": "student5@example.com", "sis_user_id": "student_5"},
    {"name": "Student Six", "email": "student6@example.com", "sis_user_id": "student_6"},
    {"name": "Student Seven", "email": "student7@example.com", "sis_user_id": "student_7"},
    {"name": "Student Eight", "email": "student8@example.com", "sis_user_id": "student_8"},
    {"name": "Student Nine", "email": "student9@example.com", "sis_user_id": "student_9"},
    {"name": "Demo UBC Student", "email": "aoludare@student.ubc.ca", "sis_user_id": None},
]

COURSES = [
    {
        "name": "Introduction to Computer Science",
        "course_code": "COSC 101",
        "teacher_email": "prof1@example.com",
        "student_emails": [
            "student1@example.com",
            "student2@example.com",
            "student3@example.com",
            "student4@example.com",
        ],
    },
    {
        "name": "Data Structures and Algorithms",
        "course_code": "COSC 201",
        "teacher_email": "prof2@example.com",
        "student_emails": [
            "student2@example.com",
            "student3@example.com",
            "student5@example.com",
            "student6@example.com",
        ],
    },
    {
        "name": "Computation, Programs, and Programming",
        "course_code": "COSC 110",
        "teacher_email": "prof3@example.com",
        "student_emails": [
            "student4@example.com",
            "student5@example.com",
            "student7@example.com",
            "student8@example.com",
        ],
    },
    {
        "name": "Computer Programming II",
        "course_code": "COSC 121",
        "teacher_email": "prof4@example.com",
        "student_emails": [
            "student6@example.com",
            "student7@example.com",
            "student9@example.com",
            "aoludare@student.ubc.ca",
        ],
    },
]


class CanvasClient:
    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token

    def request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        query: dict[str, str] | None = None,
    ) -> Any:
        url = f"{self.base_url}/api/v1{path}"
        if query:
            url = f"{url}?{urllib.parse.urlencode(query)}"

        data = None
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
        }
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"{method} {path} -> HTTP {exc.code}: {detail}") from exc

    def get(self, path: str, **query: str) -> Any:
        return self.request("GET", path, query=query or None)

    def post(self, path: str, body: dict[str, Any]) -> Any:
        return self.request("POST", path, body=body)

    def delete(self, path: str, **query: str) -> Any:
        return self.request("DELETE", path, query=query or None)


def log(msg: str) -> None:
    print(f"[seed-local-canvas] {msg}")


def normalize_token(token: str) -> str:
    """Strip whitespace and accidental surrounding quotes from pasted tokens."""
    t = token.strip()
    if len(t) >= 2 and t[0] == t[-1] and t[0] in "\"'":
        t = t[1:-1].strip()
    return t


def verify_token(client: CanvasClient) -> dict[str, Any]:
    """Fail fast with a clear message if the token is missing or invalid."""
    try:
        profile = client.get("/users/self/profile")
    except RuntimeError as exc:
        if "401" in str(exc) or "Invalid access token" in str(exc):
            print(
                "Error: Canvas rejected the access token (HTTP 401).\n"
                "\n"
                "Check:\n"
                "  1. ADMIN_TOKEN is pasted with no extra spaces or quotes\n"
                "  2. Token was created on THIS instance: "
                f"{client.base_url}\n"
                "  3. Token was copied in full (format like 1234~AbCdEf...)\n"
                "  4. Token was not revoked in Canvas → Settings → Approved Integrations\n"
                "  5. You used the SITE ADMIN account from docker_dev_setup (not a student/teacher)\n"
                "\n"
                "Create a new token: log in as admin → Account → Settings → "
                "Approved Integrations → + New Access Token",
                file=sys.stderr,
            )
            raise SystemExit(1) from exc
        raise

    if not isinstance(profile, dict):
        print("Error: unexpected response from /users/self/profile", file=sys.stderr)
        raise SystemExit(1)

    name = profile.get("name") or profile.get("short_name") or profile.get("id")
    log(f"token ok — logged in as {name} (user id={profile.get('id')})")
    return profile


def paginate(client: CanvasClient, path: str, **query: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    page = 1
    while True:
        batch = client.get(path, per_page="100", page=str(page), **query)
        if not isinstance(batch, list) or not batch:
            break
        items.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return items


def protected_user_ids(client: CanvasClient) -> set[int]:
    """Admin accounts and the API token holder are never deleted."""
    protected: set[int] = set()

    me = client.get("/users/self/profile")
    if isinstance(me, dict) and me.get("id") is not None:
        protected.add(int(me["id"]))

    admins = paginate(client, "/accounts/self/admins")
    for admin in admins:
        user = admin.get("user")
        if isinstance(user, dict) and user.get("id") is not None:
            protected.add(int(user["id"]))
        elif admin.get("user_id") is not None:
            protected.add(int(admin["user_id"]))

    log(f"protected user ids (admins + token holder): {sorted(protected)}")
    return protected


def delete_user(client: CanvasClient, user_id: int, label: str, protected: set[int]) -> None:
    if user_id in protected:
        return
    try:
        client.delete(f"/accounts/self/users/{user_id}")
        log(f"  deleted user {user_id} ({label})")
    except RuntimeError as exc:
        log(f"  skip user {user_id} ({label}): {exc}")


def reset_canvas(client: CanvasClient) -> None:
    """Delete all courses and non-admin users in the root account."""
    log("reset: deleting courses...")
    courses = paginate(client, "/accounts/self/courses")
    for course in courses:
        course_id = course.get("id")
        if course_id is None:
            continue
        name = course.get("name") or course.get("course_code") or course_id
        try:
            client.delete(f"/courses/{course_id}", event="delete")
            log(f"  deleted course {course_id} ({name})")
        except RuntimeError as exc:
            log(f"  skip course {course_id}: {exc}")

    log("reset: deleting non-admin users...")
    protected = protected_user_ids(client)

    # Explicitly remove seed emails (catches users missed by pagination).
    for person in TEACHERS + STUDENTS:
        found = find_user_by_email(client, person["email"])
        if found and found.get("id") is not None:
            delete_user(client, int(found["id"]), person["email"], protected)

    # Remove any remaining non-admin users (two passes — list can shift after deletes).
    for _ in range(2):
        users = paginate(client, "/accounts/self/users")
        for user in users:
            user_id = user.get("id")
            if user_id is None:
                continue
            login = user.get("login_id") or user.get("email") or user_id
            delete_user(client, int(user_id), str(login), protected)

    log(
        "reset complete (note: soft-deleted users may still hold SIS IDs; "
        "seed will skip duplicate sis_user_id if needed)"
    )


def find_user_by_email(client: CanvasClient, email: str) -> dict[str, Any] | None:
    results = client.get("/accounts/self/users", search_term=email, per_page="100")
    if not isinstance(results, list):
        return None
    email_lower = email.lower()
    for user in results:
        if str(user.get("login_id", "")).lower() == email_lower:
            return user
        if str(user.get("email", "")).lower() == email_lower:
            return user
    return None


def create_user(
    client: CanvasClient,
    *,
    name: str,
    email: str,
    password: str,
    sis_user_id: str | None = None,
) -> dict[str, Any]:
    pseudonym: dict[str, Any] = {
        "unique_id": email,
        "password": password,
        "password_confirmation": password,
    }
    if sis_user_id:
        pseudonym["sis_user_id"] = sis_user_id

    body = {
        "user": {"name": name},
        "pseudonym": pseudonym,
        "communication_channel": {"type": "email", "address": email},
    }

    try:
        return client.post("/accounts/self/users", body)
    except RuntimeError as exc:
        err = str(exc)
        if sis_user_id and ("sis_user_id" in err.lower() or "sis id" in err.lower()):
            log(
                f"  sis_user_id {sis_user_id!r} already held by a soft-deleted user; "
                f"creating {email} without SIS id"
            )
            pseudonym.pop("sis_user_id", None)
            body["pseudonym"] = pseudonym
            return client.post("/accounts/self/users", body)
        raise


def get_or_create_user(
    client: CanvasClient,
    *,
    name: str,
    email: str,
    password: str,
    sis_user_id: str | None = None,
) -> dict[str, Any]:
    existing = find_user_by_email(client, email)
    if existing:
        log(f"user exists: {email} (id={existing['id']})")
        return existing

    created = create_user(
        client,
        name=name,
        email=email,
        password=password,
        sis_user_id=sis_user_id,
    )
    log(f"created user: {email} (id={created['id']})")
    return created


def find_course_by_code(client: CanvasClient, course_code: str) -> dict[str, Any] | None:
    courses = paginate(client, "/accounts/self/courses")
    for course in courses:
        if course.get("course_code") == course_code:
            return course
    return None


def enroll_user(
    client: CanvasClient,
    course_id: int,
    user_id: int,
    enrollment_type: str,
) -> None:
    try:
        client.post(
            f"/courses/{course_id}/enrollments",
            {
                "enrollment": {
                    "user_id": user_id,
                    "type": enrollment_type,
                    "enrollment_state": "active",
                }
            },
        )
        log(f"  enrolled {enrollment_type} user {user_id} in course {course_id}")
    except RuntimeError as exc:
        if "already" in str(exc).lower() or "422" in str(exc):
            log(f"  enrollment may already exist: user {user_id} in course {course_id}")
        else:
            raise


def get_or_create_course(
    client: CanvasClient,
    *,
    name: str,
    course_code: str,
    teacher_user_id: int,
) -> int:
    existing = find_course_by_code(client, course_code)
    if existing:
        course_id = int(existing["id"])
        log(f"course exists: {course_code} (id={course_id})")
    else:
        created = client.post(
            "/accounts/self/courses",
            {
                "course": {
                    "name": name,
                    "course_code": course_code,
                    "license": "private",
                }
            },
        )
        course_id = int(created["id"])
        log(f"created course: {course_code} (id={course_id})")

    enroll_user(client, course_id, teacher_user_id, "TeacherEnrollment")
    return course_id


def seed_canvas(client: CanvasClient, password: str) -> None:
    teachers_by_email: dict[str, dict[str, Any]] = {}
    for t in TEACHERS:
        teachers_by_email[t["email"]] = get_or_create_user(
            client,
            name=t["name"],
            email=t["email"],
            password=password,
        )

    students_by_email: dict[str, dict[str, Any]] = {}
    for s in STUDENTS:
        students_by_email[s["email"]] = get_or_create_user(
            client,
            name=s["name"],
            email=s["email"],
            password=password,
            sis_user_id=s.get("sis_user_id"),
        )

    for spec in COURSES:
        teacher_id = int(teachers_by_email[spec["teacher_email"]]["id"])
        course_id = get_or_create_course(
            client,
            name=spec["name"],
            course_code=spec["course_code"],
            teacher_user_id=teacher_id,
        )
        for email in spec["student_emails"]:
            student_id = int(students_by_email[email]["id"])
            enroll_user(client, course_id, student_id, "StudentEnrollment")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Reset and seed local Canvas with teachers, courses, and students."
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("CANVAS_URL") or CANVAS_BASE_URL,
        help="Canvas base URL (default: CANVAS_BASE_URL at top of file)",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("CANVAS_ADMIN_TOKEN") or ADMIN_TOKEN,
        help="Admin API token (default: ADMIN_TOKEN at top of file)",
    )
    parser.add_argument(
        "--password",
        default=os.environ.get("CANVAS_SEED_PASSWORD") or USER_PASSWORD,
        help="Password for new users (default: USER_PASSWORD at top of file)",
    )
    reset_group = parser.add_mutually_exclusive_group()
    reset_group.add_argument(
        "--reset",
        action="store_true",
        default=None,
        help="Delete all courses and non-admin users before seeding",
    )
    reset_group.add_argument(
        "--no-reset",
        action="store_true",
        help="Skip reset; upsert users/courses only",
    )
    parser.add_argument(
        "--reset-only",
        action="store_true",
        help="Only reset (delete courses + non-admin users), do not seed",
    )
    return parser.parse_args()


def should_reset(args: argparse.Namespace) -> bool:
    if args.reset_only:
        return True
    if args.no_reset:
        return False
    if args.reset is True:
        return True
    return RESET_BEFORE_SEED


def main() -> int:
    args = parse_args()
    token = normalize_token(str(args.token or ""))
    if not token:
        print(
            "Error: admin token is empty.\n"
            "Open this file and paste your token into ADMIN_TOKEN near the top.",
            file=sys.stderr,
        )
        return 1

    client = CanvasClient(args.url, token)
    log(f"Canvas: {args.url.rstrip('/')}")
    log(f"password: {args.password}")
    verify_token(client)

    if should_reset(args):
        reset_canvas(client)
    else:
        log("reset skipped (--no-reset)")

    if not args.reset_only:
        log("seeding...")
        seed_canvas(client, args.password)

    log("")
    log("Done.")
    if not args.reset_only:
        log(f"  Teachers ({len(TEACHERS)}): {', '.join(t['email'] for t in TEACHERS)}")
        log(f"  Students ({len(STUDENTS)}): {', '.join(s['email'] for s in STUDENTS)}")
        log(f"  Courses ({len(COURSES)}): {', '.join(c['course_code'] for c in COURSES)}")
        log("")
        log("Next: log in as prof1@example.com, create a personal access token, test roster APIs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
