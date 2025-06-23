import { useEffect, useState } from "react";
import { useSession } from "~/lib/auth";
import { Link, useNavigate } from "react-router-dom";

type Course = {
  id: string;
  name: string;
  code: string;
  term: string;
  year: number;
  isActive: boolean;
  aiInstructions: string;
};

type UserWithRole = {
  role?: string;
  id?: string;
};

export default function CoursesPage() {
  const { data: session } = useSession();
  const [courses, setCourses] = useState<Course[]>([]);
  const [form, setForm] = useState({
    name: "",
    code: "",
    term: "Fall",
    year: new Date().getFullYear(),
    aiInstructions: "",
  });

  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Course>>({});

  const isAdmin = session?.user?.role === "ADMIN";
  const isProfessor = session?.user?.role === "PROFESSOR";

  useEffect(() => {
    fetch("/api/courses")
      .then((res) => res.json())
      .then((data) => setCourses(data));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setEditForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const createCourse = async () => {
    const payload = { ...form, year: Number(form.year) };
    const res = await fetch("/api/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const newCourse = await res.json();
      setCourses((prev) => [...prev, newCourse]);
      setForm({ name: "", code: "", term: "Fall", year: new Date().getFullYear(), aiInstructions: "" });
    } else {
      const err = await res.text();
      alert(`Failed to create course: ${err}`);
    }
  };

  const startEdit = (course: Course) => {
    setEditingCourseId(course.id);
    setEditForm({ ...course });
  };

  const cancelEdit = () => {
    setEditingCourseId(null);
    setEditForm({});
  };

  const saveEdit = async (courseId: string) => {
    const res = await fetch(`/api/courses/${courseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });

    if (res.ok) {
      const updated = await res.json();
      setCourses((prev) => prev.map((c) => (c.id === courseId ? updated : c)));
      cancelEdit();
    } else {
      const err = await res.text();
      alert(`Update failed: ${err}`);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto text-white">
      <h1 className="text-2xl font-bold mb-4">Courses</h1>

      <ul className="space-y-4">
        {courses.map((course) => (
          <li key={course.id} className="p-4 bg-gray-800 shadow rounded">
            {editingCourseId === course.id ? (
              <div className="space-y-2">
                <input
                  name="name"
                  value={editForm.name || ""}
                  onChange={handleEditChange}
                  placeholder="Name"
                  className="w-full border p-2 rounded bg-gray-900 text-white"
                />
                <input
                  name="code"
                  value={editForm.code || ""}
                  onChange={handleEditChange}
                  placeholder="Code"
                  className="w-full border p-2 rounded bg-gray-900 text-white"
                />
                <input
                  name="term"
                  value={editForm.term || ""}
                  onChange={handleEditChange}
                  placeholder="Term"
                  className="w-full border p-2 rounded bg-gray-900 text-white"
                />
                <input
                  name="year"
                  type="number"
                  value={editForm.year || ""}
                  onChange={handleEditChange}
                  placeholder="Year"
                  className="w-full border p-2 rounded bg-gray-900 text-white"
                />
                <input
                  name="aiInstructions"
                  value={editForm.aiInstructions || ""}
                  onChange={handleEditChange}
                  placeholder="AI Instructions"
                  className="w-full border p-2 rounded bg-gray-900 text-white"
                />
                <div className="flex gap-2">
                  <button onClick={() => saveEdit(course.id)} className="bg-green-600 px-4 py-1 rounded">
                    Save
                  </button>
                  <button onClick={cancelEdit} className="bg-gray-600 px-4 py-1 rounded">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <h2 className="font-semibold text-lg">{course.code}: {course.name}</h2>
                <p className="text-sm text-gray-400">
                  {course.term} {course.year} — {course.isActive ? "Active" : "Inactive"}
                </p>
                <p className="text-sm text-gray-500 mt-1 italic">AI: {course.aiInstructions}</p>
                {(isAdmin || isProfessor) && (
                  <button
                    onClick={() => startEdit(course)}
                    className="mt-2 text-indigo-400 hover:text-indigo-200 text-sm"
                  >
                    Edit
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {isAdmin && (
        <div className="mt-8 border-t pt-6">
          <h2 className="text-xl font-semibold mb-2">Create New Course</h2>
          <div className="space-y-3">
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="Course Name"
              className="w-full border p-2 rounded bg-gray-900 text-white"
            />
            <input
              name="code"
              value={form.code}
              onChange={handleChange}
              placeholder="Course Code (e.g., CS101)"
              className="w-full border p-2 rounded bg-gray-900 text-white"
            />
            <select name="term" value={form.term} onChange={handleChange} className="w-full border p-2 rounded bg-gray-900 text-white">
              <option>Fall</option>
              <option>Spring</option>
              <option>Summer</option>
            </select>
            <input
              name="year"
              type="number"
              value={form.year}
              onChange={handleChange}
              placeholder="Year"
              className="w-full border p-2 rounded bg-gray-900 text-white"
            />
            <input
              name="aiInstructions"
              value={form.aiInstructions}
              onChange={handleChange}
              placeholder="AI Instructions"
              className="w-full border p-2 rounded bg-gray-900 text-white"
            />
            <button
              onClick={createCourse}
              className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
            >
              Create Course
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
