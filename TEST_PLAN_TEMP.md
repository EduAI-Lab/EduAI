# Test Plan — RBAC UI + Admin/Instructor Permission Changes

### Setup

Seed personas are in the DB. Use these accounts (password: `EduAI2026!`):

| Role | Email | Notes |
|------|-------|-------|
| ADMIN | admin seed account | full access |
| UNIT_ADMIN | unit_admin seed | scoped to one department |
| INSTRUCTOR | instructor seed | owns specific courses |
| TA | ta seed | assigned to specific courses |
| STUDENT | student seed | enrolled in specific courses |

---

### 1. Role-Gated Course List (`/courses`)

**As ADMIN**
- See all courses; "Create Course" button visible
- Edit / delete / publish toggle on every card

**As UNIT_ADMIN**
- See only courses in your authorized department(s)
- "Create Course" available; department dropdown pre-filtered to authorized units
- Cannot see courses from other departments

**As INSTRUCTOR**
- See only courses where you are the assigned instructor
- No "Create Course" button

**As TA**
- See only courses you are assigned to as TA
- No create/edit/delete controls

**As STUDENT**
- See only published courses you are enrolled in
- No create/edit/delete controls

---

### 2. Role-Gated Course Detail (`/courses/:id`)

**As ADMIN / UNIT_ADMIN / INSTRUCTOR** — shows `CourseDetailManagerView`:
- Overview tab: course info, AI instructions (if set), instructor name
- Materials tab: upload enabled
- Topics tab: add/delete topics
- Enrollments tab: enrolled users list
- Staff tab (ADMIN/UNIT_ADMIN only): instructor reassignment + TA management

**As TA** — shows `CourseDetailTaView`:
- Overview, Materials (upload enabled), Topics (read-only)
- No Staff or Enrollments tab

**As STUDENT** — shows `CourseDetailStudentView`:
- Overview (description + topic badges), Materials (read-only)
- No upload, no topics management

---

### 3. Staff Tab — Instructor Reassignment

*Requires ADMIN or UNIT_ADMIN session on a course detail page.*

1. Open a course → Staff tab
2. Current instructor shown with "Current" badge
3. Select a different instructor from dropdown → click **Assign**
4. Success message appears; instructor name updates without page reload
5. **UNIT_ADMIN**: cannot assign an instructor outside their authorized units

---

### 4. Staff Tab — TA Management

*Same access as above.*

1. Open a course → Staff tab → Teaching Assistants section
2. Add a TA: select from dropdown → click **Add TA**
3. New TA appears in list
4. Remove a TA: click trash icon on a TA row
5. TA disappears from list
6. **Verify**: the added TA can now see the course when logged in as that TA

---

### 5. Course Create / Edit / Delete

**Create (ADMIN or UNIT_ADMIN):**
- Click "Create Course" → fill name, code (auto-prefixes department), term, year, department
- Course appears in list

**Edit:**
- Click edit on a course card → change name or code → Save
- Updated values reflect in card

**Delete (with confirmation):**
- Click delete on a course → confirm dialog appears → confirm
- Course removed from list
- **UNIT_ADMIN**: can only delete courses in their authorized department

**Publish toggle:**
- Toggle published state on any course card
- Students can only see the course after it is published

---

### 6. Bug Fix — Duplicate Material Upload

1. Upload a file (e.g. `syllabus.pdf`) to Course A → succeeds
2. Upload the **same file** to Course B → should also succeed
3. Previously this would fail with a unique constraint error

---

### 7. Bug Fix — Instructor Topic Management

1. Log in as INSTRUCTOR
2. Open a course you teach → Topics tab
3. Add a new topic → should succeed
4. Previously instructors got a 403

---

### 8. Admin User Management (`/admin/users`)

1. Log in as ADMIN → navigate to `/admin/users`
2. Users table loads
3. **Activity column**: "Courses: N" should show a real number, not `NaN`
4. Courses count = enrolled courses + TA assignments + taught courses combined

---

### 9. UNIT_ADMIN Scoping Invariants

1. Log in as UNIT_ADMIN
2. Cannot see courses outside authorized department on `/courses`
3. Creating a course with an unauthorized department → blocked (403)
4. Editing a course to move it to an unauthorized department → blocked

---

### Quick Regression Checks

- ADMIN can still upload materials to any course
- Instructor cannot access a course they don't teach (redirected to `/courses?access=denied`)
- TA cannot access a course they're not assigned to
- Student cannot access an unpublished course
