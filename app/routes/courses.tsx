import { useEffect, useState } from "react";
import { useSession } from "~/lib/auth";
import { Form } from "react-router";

type Course = {
  id: string;
  name: string;
  code: string;
  term: string;
  year: number;
  isActive: boolean;
  aiInstructions: string;
};

export default function CoursesPage() {
  const { data: session } = useSession();
  const [courses, setCourses] = useState<Course[]>([]);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Course>>({});

  const isAdmin = session?.user?.role === "ADMIN";
  const isProfessor = session?.user?.role === "PROFESSOR";

  useEffect(() => {
    fetch("/api/courses")
      .then((res) => res.json())
      .then((data) => setCourses(data));
  }, []);

  const handleEditChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setEditForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
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
                  <button
                    onClick={() => saveEdit(course.id)}
                    className="bg-green-600 px-4 py-1 rounded"
                  >
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="bg-gray-600 px-4 py-1 rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <h2 className="font-semibold text-lg">
                  {course.code}: {course.name}
                </h2>
                <p className="text-sm text-gray-400">
                  {course.term} {course.year} —{" "}
                  {course.isActive ? "Active" : "Inactive"}
                </p>
                <p className="text-sm text-gray-500 mt-1 italic">
                  AI: {course.aiInstructions}
                </p>
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
          <Form
            method="post"
            action="/api/courses"
            className="space-y-3"
          >
            <input
              name="name"
              placeholder="Course Name"
              className="w-full border p-2 rounded bg-gray-900 text-white"
              required
            />
            <input
              name="code"
              placeholder="Course Code (e.g., CS101)"
              className="w-full border p-2 rounded bg-gray-900 text-white"
              required
            />
            <select
              name="term"
              className="w-full border p-2 rounded bg-gray-900 text-white"
              defaultValue="Fall"
            >
              <option>Fall</option>
              <option>Spring</option>
              <option>Summer</option>
            </select>
            <input
              name="year"
              type="number"
              placeholder="Year"
              defaultValue={new Date().getFullYear()}
              className="w-full border p-2 rounded bg-gray-900 text-white"
              required
            />
            <input
              name="aiInstructions"
              placeholder="AI Instructions"
              className="w-full border p-2 rounded bg-gray-900 text-white"
            />
            <button
              type="submit"
              className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
            >
              Create Course
            </button>
          </Form>
        </div>
      )}
    </div>
  );
}
