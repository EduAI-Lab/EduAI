import { useEffect, useState } from "react";
import { useSession } from "~/lib/auth";
import { useNavigate } from "react-router";

type Course = {
  id: string;
  name: string;
  code: string;
  term: string;
  year: number;
  isActive: boolean;
};

type UserWithRole = {
  role?: string;
};

export default function CoursesPage() {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [form, setForm] = useState({
    name: "",
    code: "",
    term: "Fall",
    year: new Date().getFullYear(),
  });

  useEffect(() => {
    fetch("/api/courses")
      .then((res) => res.json())
      .then((data) => setCourses(data));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const createCourse = async () => {
    const res = await fetch("/api/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    if (res.ok) {
      const newCourse = await res.json();
      setCourses((prev) => [...prev, newCourse]);
      setForm({ name: "", code: "", term: "Fall", year: new Date().getFullYear() });
    } else {
      const err = await res.text();
      alert(`Failed to create course: ${err}`);
    }
  };

  const user = (session && session.user) as UserWithRole | undefined;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Courses</h1>

      <ul className="space-y-2">
        {courses.map((course) => (
          <li key={course.id} className="p-4 bg-white shadow rounded">
            <h2 className="font-semibold">{course.code}: {course.name}</h2>
            <p className="text-sm text-gray-600">
              {course.term} {course.year} — {course.isActive ? "Active" : "Inactive"}
            </p>
          </li>
        ))}
      </ul>

      {user?.role === "ADMIN" && (
        <div className="mt-8 border-t pt-6">
          <h2 className="text-xl font-semibold mb-2">Create New Course</h2>

          <div className="space-y-4">
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="Course Name"
              className="w-full border p-2 rounded"
            />
            <input
              name="code"
              value={form.code}
              onChange={handleChange}
              placeholder="Course Code (e.g., CS101)"
              className="w-full border p-2 rounded"
            />
            <select name="term" value={form.term} onChange={handleChange} className="w-full border p-2 rounded">
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
              className="w-full border p-2 rounded"
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
