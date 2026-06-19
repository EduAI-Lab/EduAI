#!/usr/bin/env python
"""Seed the local Canvas dev instance with courses, students, and assignments.

Creates everything in the *active* state via the admin API, so no email
invitations are involved (the local Canvas has no mail delivery — students
enrolled through the UI would otherwise sit on "pending" forever, invisible
to our enrollment sync, which only reads state[]=active).

What it creates (idempotent — safe to re-run, keyed on SIS ids):
  - published courses under account 1, with the token's owner as teacher
  - student users with UBC-style 8-digit sis_user_id (what bubble-sheet
    matching keys on) and password "canvas123" so you can log in as them
  - active StudentEnrollments
  - published on_paper assignments

Usage (from app/backend, venv active — only needs httpx):
  python scripts/seed_canvas.py                  # seed demo data
  python scripts/seed_canvas.py --activate-pending
        # additionally: publish any unpublished course in the account and
        # flip invited/pending student enrollments to active — fixes courses
        # hand-made in the Canvas UI

Token: --token-file (default .misc/api_key.txt at the repo root) — must be an
admin token. Base URL: --base-url (default http://canvas.docker).
"""
import argparse
import sys
from pathlib import Path

import httpx

ACCOUNT_ID = 1
STUDENT_PASSWORD = "canvas123"

# Deterministic demo data. Students overlap across courses on purpose — it
# exercises the sync's upsert-on-canvas_user_id path.
STUDENTS = [
    # (sis_user_id, name)
    ("37210001", "Aiko Tanaka"),
    ("37210002", "Brandon Lee"),
    ("37210003", "Chloe Martin"),
    ("37210004", "Diego Ramirez"),
    ("37210005", "Emma Wilson"),
    ("37210006", "Farah Khan"),
    ("37210007", "Gabriel Costa"),
    ("37210008", "Hannah Nguyen"),
    ("37210009", "Isaac Goldberg"),
    ("37210010", "Jasmine Patel"),
    ("37210011", "Kai Anderson"),
    ("37210012", "Lena Hoffmann"),
    ("37210013", "Marcus Chen"),
    ("37210014", "Nadia Petrova"),
    ("37210015", "Owen Murphy"),
    ("37210016", "Priya Sharma"),
    ("37210017", "Quinn Taylor"),
    ("37210018", "Rosa Alvarez"),
    ("37210019", "Sam Okafor"),
    ("37210020", "Tara Singh"),
]

# Bulk students to exercise pagination/search at realistic scale (200+ per
# course). Deterministic name combinations, sis ids continue from STUDENTS.
_FIRST_NAMES = [
    "Ava", "Ben", "Carmen", "Daniel", "Elif", "Felix", "Grace", "Hiro",
    "Ines", "Jonas", "Keisha", "Luca", "Mei", "Noah", "Olga", "Pablo",
    "Ruth", "Sofia", "Theo", "Uma",
]
_LAST_NAMES = [
    "Abebe", "Brown", "Chow", "Dubois", "Eriksen", "Fischer", "Garcia",
    "Huang", "Ivanov", "Jung", "Kowalski", "Lopez", "Moreau", "Nakamura",
    "Olsen", "Park", "Quintero", "Rossi", "Silva", "Tremblay",
]


def _bulk_students(start_sis: int, count: int) -> list[tuple[str, str]]:
    return [
        (
            str(start_sis + i),
            f"{_FIRST_NAMES[i % len(_FIRST_NAMES)]} "
            f"{_LAST_NAMES[(i // len(_FIRST_NAMES)) % len(_LAST_NAMES)]}",
        )
        for i in range(count)
    ]


BULK_STUDENTS = _bulk_students(37210021, 180)

COURSES = [
    {
        "sis_course_id": "2026S-COSC-499-001",
        "name": "COSC 499 - Capstone Software Engineering",
        "course_code": "COSC 499 001",
        # 200 students — big enough to make pagination + search meaningful.
        "students": STUDENTS + BULK_STUDENTS,
        "assignments": [
            ("Midterm Exam", 40),
            ("Final Exam", 100),
        ],
        "materials": [
            (
                "course-syllabus.md",
                b"""# COSC 499 Capstone Software Engineering\n\n## Course Overview\nThis capstone course integrates software engineering concepts through a team project.\n\n## Learning Objectives\n- Apply software development lifecycle in a real project\n- Practice agile methodologies and sprint planning\n- Deliver a working software product to an industry partner\n\n## Schedule\n- **Week 1-2**: Project kickoff and requirements gathering\n- **Week 3-8**: Sprint development cycles\n- **Week 9-12**: Testing, refinement, and deployment\n- **Week 13**: Final presentations\n\n## Grading\n| Component | Weight |\n|---|---|\n| Midterm Exam | 20% |\n| Final Exam | 30% |\n| Project deliverables | 50% |\n""",
                "text/markdown",
            ),
            (
                "agile-reference.txt",
                b"""AGILE DEVELOPMENT REFERENCE GUIDE\n\nSCRUM ROLES\n-----------\nProduct Owner: defines requirements and prioritizes backlog\nScrum Master: facilitates process, removes blockers\nDevelopment Team: self-organizing, cross-functional builders\n\nSPRINT CEREMONIES\n-----------------\nSprint Planning: define sprint goal and select backlog items\nDaily Standup: 15-min sync on progress, plan, blockers\nSprint Review: demo completed work to stakeholders\nSprint Retrospective: inspect and adapt the process\n\nKEY METRICS\n-----------\nVelocity: story points completed per sprint\nBurndown Chart: remaining work vs. time\nDefect Density: bugs per unit of code\n\nDEFINITION OF DONE\n------------------\n- Code reviewed and approved\n- Unit tests written and passing\n- Integration tests passing\n- Documentation updated\n- Deployed to staging environment\n""",
                "text/plain",
            ),
        ],
    },
    {
        "sis_course_id": "2026S-COSC-310-001",
        "name": "COSC 310 - Software Engineering",
        "course_code": "COSC 310 001",
        "students": STUDENTS[6:18],
        "assignments": [
            ("Midterm 1", 30),
            ("Midterm 2", 30),
            ("Final Exam", 80),
        ],
        "materials": [
            (
                "course-outline.md",
                b"""# COSC 310 Software Engineering\n\n## Topics Covered\n1. Software Development Lifecycle\n2. Requirements Engineering\n3. Software Design Patterns\n4. Testing and Quality Assurance\n5. Project Management\n6. Maintenance and Evolution\n\n## Textbook\n*Software Engineering* by Ian Sommerville, 10th Edition\n\n## Assessment\n- Midterm 1: 25%\n- Midterm 2: 25%\n- Final Exam: 40%\n- Assignments: 10%\n""",
                "text/markdown",
            ),
            (
                "design-patterns-notes.txt",
                b"""DESIGN PATTERNS LECTURE NOTES\n\nCREATIONAL PATTERNS\n-------------------\nSingleton: ensures a class has only one instance\nFactory Method: defines interface for creating objects\nAbstract Factory: creates families of related objects\nBuilder: constructs complex objects step by step\n\nSTRUCTURAL PATTERNS\n-------------------\nAdapter: converts interface of a class into another interface\nBridge: separates abstraction from implementation\nComposite: treats individual objects and groups uniformly\nDecorator: adds responsibilities to objects dynamically\nFacade: provides simplified interface to complex subsystem\n\nBEHAVIOURAL PATTERNS\n--------------------\nObserver: defines one-to-many dependency between objects\nStrategy: defines family of algorithms, encapsulates each one\nCommand: encapsulates request as an object\nIterator: provides way to access elements sequentially\nTemplate Method: defines skeleton of algorithm in base class\n""",
                "text/plain",
            ),
        ],
    },
    {
        "sis_course_id": "2026S-MATH-200-002",
        "name": "MATH 200 - Calculus III",
        "course_code": "MATH 200 002",
        "students": STUDENTS[10:],
        "assignments": [
            ("Quiz 1", 20),
            ("Final Exam", 60),
        ],
        "materials": [
            (
                "course-outline.md",
                b"""# MATH 200 Calculus III\n\n## Topics\n1. Vectors and the geometry of space\n2. Vector functions and space curves\n3. Partial derivatives\n4. Multiple integrals\n5. Vector calculus\n6. Green's, Stokes', and the Divergence Theorem\n\n## Grading\n- Quiz 1: 25%\n- Final Exam: 75%\n""",
                "text/markdown",
            ),
            (
                "partial-derivatives-notes.txt",
                b"""PARTIAL DERIVATIVES - LECTURE NOTES\n\nDEFINITION\n----------\nFor f(x,y), the partial derivative with respect to x:\n  df/dx = lim[h->0] (f(x+h,y) - f(x,y)) / h\n\nTreated as: differentiate with respect to x, hold y constant.\n\nNOTATION\n--------\n- df/dx or f_x or D_x f (partial with respect to x)\n- df/dy or f_y or D_y f (partial with respect to y)\n\nCHAIN RULE (multivariable)\n---------------------------\nIf z = f(x,y), x = g(t), y = h(t), then:\n  dz/dt = (dz/dx)(dx/dt) + (dz/dy)(dy/dt)\n\nGRADIENT\n--------\nnabla f = (df/dx)i + (df/dy)j + (df/dz)k\n\nPoints in the direction of greatest increase of f.\nMagnitude = rate of greatest increase.\n\nCRITICAL POINTS\n---------------\nSet df/dx = 0 and df/dy = 0, solve simultaneously.\nUse second derivative test (discriminant D = f_xx*f_yy - (f_xy)^2):\n  D > 0, f_xx > 0: local minimum\n  D > 0, f_xx < 0: local maximum\n  D < 0: saddle point\n  D = 0: test inconclusive\n""",
                "text/plain",
            ),
        ],
    },
]


def email_for(name: str, sis_id: str) -> str:
    first = name.split()[0].lower()
    return f"{first}.{sis_id}@students.ubc.ca"


class Canvas:
    def __init__(self, base_url: str, token: str):
        self.http = httpx.Client(
            base_url=f"{base_url}/api/v1",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )

    def get_paginated(self, path: str, params: dict | None = None) -> list[dict]:
        items: list[dict] = []
        resp = self.http.get(path, params={**(params or {}), "per_page": 100})
        resp.raise_for_status()
        items.extend(resp.json())
        while "next" in resp.links:
            resp = self.http.get(resp.links["next"]["url"])
            resp.raise_for_status()
            items.extend(resp.json())
        return items

    # ---- users ----------------------------------------------------------- #
    def find_user_by_sis(self, sis_id: str) -> dict | None:
        resp = self.http.get(f"/users/sis_user_id:{sis_id}")
        return resp.json() if resp.status_code == 200 else None

    def ensure_student(self, sis_id: str, name: str) -> dict:
        existing = self.find_user_by_sis(sis_id)
        if existing:
            return existing
        resp = self.http.post(
            f"/accounts/{ACCOUNT_ID}/users",
            data={
                "user[name]": name,
                "user[skip_registration]": "true",
                "user[terms_of_use]": "true",
                "pseudonym[unique_id]": email_for(name, sis_id),
                "pseudonym[password]": STUDENT_PASSWORD,
                "pseudonym[sis_user_id]": sis_id,
                "pseudonym[send_confirmation]": "false",
                "communication_channel[type]": "email",
                "communication_channel[address]": email_for(name, sis_id),
                "communication_channel[skip_confirmation]": "true",
            },
        )
        resp.raise_for_status()
        print(f"  + student {name} (sis {sis_id})")
        return resp.json()

    # ---- courses --------------------------------------------------------- #
    def find_course_by_sis(self, sis_course_id: str) -> dict | None:
        resp = self.http.get(f"/courses/sis_course_id:{sis_course_id}")
        return resp.json() if resp.status_code == 200 else None

    def ensure_course(self, spec: dict) -> dict:
        existing = self.find_course_by_sis(spec["sis_course_id"])
        if existing:
            return existing
        resp = self.http.post(
            f"/accounts/{ACCOUNT_ID}/courses",
            data={
                "course[name]": spec["name"],
                "course[course_code]": spec["course_code"],
                "course[sis_course_id]": spec["sis_course_id"],
                "offer": "true",  # publish — enrollments in unpublished courses stay pending
            },
        )
        resp.raise_for_status()
        print(f"+ course {spec['name']}")
        return resp.json()

    def publish_course(self, course_id: int) -> None:
        resp = self.http.put(f"/courses/{course_id}", data={"course[event]": "offer"})
        resp.raise_for_status()

    # ---- enrollments ----------------------------------------------------- #
    def enroll(self, course_id: int, user_id: int, role: str) -> dict:
        """Idempotent: re-posting an existing enrollment returns it; posting
        over an invited one flips it to active."""
        resp = self.http.post(
            f"/courses/{course_id}/enrollments",
            data={
                "enrollment[user_id]": user_id,
                "enrollment[type]": role,
                "enrollment[enrollment_state]": "active",
            },
        )
        resp.raise_for_status()
        return resp.json()

    # ---- files ----------------------------------------------------------- #
    def list_files(self, course_id: int) -> list[dict]:
        return self.get_paginated(f"/courses/{course_id}/files")

    def upload_file(self, course_id: int, name: str, content: bytes, content_type: str) -> dict:
        """Two-step Canvas file upload (pre-flight + POST to upload_url)."""
        preflight = self.http.post(
            f"/courses/{course_id}/files",
            data={
                "name": name,
                "size": len(content),
                "content_type": content_type,
                "on_duplicate": "overwrite",
            },
        )
        preflight.raise_for_status()
        info = preflight.json()

        upload_params = info.get("upload_params", {})
        files = {"file": (name, content, content_type)}
        upload_resp = httpx.post(
            info["upload_url"],
            data=upload_params,
            files=files,
            follow_redirects=True,
            timeout=60,
        )
        upload_resp.raise_for_status()
        file_obj = upload_resp.json()
        print(f"  + file {name} ({len(content)} bytes)")
        return file_obj

    def ensure_file(self, course_id: int, name: str, content: bytes, content_type: str) -> dict:
        existing = self.list_files(course_id)
        if any(f["display_name"] == name for f in existing):
            return next(f for f in existing if f["display_name"] == name)
        return self.upload_file(course_id, name, content, content_type)

    # ---- assignments ----------------------------------------------------- #
    def ensure_assignment(self, course_id: int, name: str, points: float) -> None:
        existing = self.get_paginated(f"/courses/{course_id}/assignments")
        if any(a["name"] == name for a in existing):
            return
        resp = self.http.post(
            f"/courses/{course_id}/assignments",
            data={
                "assignment[name]": name,
                "assignment[points_possible]": points,
                "assignment[submission_types][]": "on_paper",
                "assignment[published]": "true",
            },
        )
        resp.raise_for_status()
        print(f"  + assignment {name} ({points} pts)")


def seed(canvas: Canvas) -> None:
    teacher_id = canvas.http.get("/users/self").json()["id"]
    for spec in COURSES:
        course = canvas.ensure_course(spec)
        canvas.enroll(course["id"], teacher_id, "TeacherEnrollment")
        for sis_id, name in spec["students"]:
            student = canvas.ensure_student(sis_id, name)
            canvas.enroll(course["id"], student["id"], "StudentEnrollment")
        for name, points in spec["assignments"]:
            canvas.ensure_assignment(course["id"], name, points)
        for filename, content, content_type in spec.get("materials", []):
            canvas.ensure_file(course["id"], filename, content, content_type)
        n = len(spec["students"])
        print(f"  = {spec['course_code']}: {n} active students, course id {course['id']}")


def activate_pending(canvas: Canvas) -> None:
    """Publish unpublished courses and activate invited/pending student
    enrollments across the whole account — repairs courses made by hand in
    the Canvas UI, whose invitations can never be accepted (no email)."""
    courses = canvas.get_paginated(
        f"/accounts/{ACCOUNT_ID}/courses", {"state[]": ["unpublished", "available"]}
    )
    for course in courses:
        if course["workflow_state"] == "unpublished":
            canvas.publish_course(course["id"])
            print(f"~ published course {course['name']} (id {course['id']})")
        pending = canvas.get_paginated(
            f"/courses/{course['id']}/enrollments",
            {"type[]": ["StudentEnrollment"], "state[]": ["invited", "creation_pending"]},
        )
        for enrollment in pending:
            canvas.enroll(course["id"], enrollment["user_id"], "StudentEnrollment")
            print(f"~ activated enrollment of user {enrollment['user_id']} in {course['name']}")


def main() -> int:
    repo_root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://canvas.docker")
    parser.add_argument("--token-file", type=Path, default=repo_root / ".misc" / "api_key.txt")
    parser.add_argument(
        "--activate-pending",
        action="store_true",
        help="also publish unpublished courses and activate pending enrollments account-wide",
    )
    args = parser.parse_args()

    token = args.token_file.read_text().strip()
    canvas = Canvas(args.base_url, token)
    me = canvas.http.get("/users/self")
    if me.status_code != 200:
        print(f"Token check failed ({me.status_code}) — is {args.base_url} up?", file=sys.stderr)
        return 1
    print(f"Authenticated as {me.json()['name']} against {args.base_url}")

    seed(canvas)
    if args.activate_pending:
        activate_pending(canvas)
    print("Done. Import the courses in the app, or re-sync existing ones.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
