/* Courses.jsx — faithful to courses.tsx: code/name/term/badge/role-actions + create dialog */

const _COURSES_DATA = [
  { id:"1", code:"CPSC 110", name:"Computation, Programs, and Programming", term:"Fall",   year:2024, isActive:true,  professorId:"p1", aiInstructions:"Focus on functional programming concepts and design recipes. Emphasize HtDF and HtDW design patterns.", description:"Systematic program design using the functional core of a modern object-oriented language." },
  { id:"2", code:"MATH 200", name:"Calculus III",                           term:"Fall",   year:2024, isActive:true,  professorId:"p2", aiInstructions:"Help students with multivariable calculus, partial derivatives, and vector fields.", description:"Sequences and series, partial derivatives, multiple integration, vector calculus." },
  { id:"3", code:"PHYS 101", name:"Energy and Waves",                       term:"Fall",   year:2024, isActive:false, professorId:"p3", aiInstructions:"", description:"Energy, momentum, oscillations, waves, and thermodynamics." },
  { id:"4", code:"CPSC 210", name:"Software Construction",                  term:"Winter", year:2024, isActive:true,  professorId:"p1", aiInstructions:"Focus on object-oriented design, design patterns, and software testing.", description:"Design, development, and analysis of robust software components." },
  { id:"5", code:"STAT 200", name:"Elementary Statistics",                  term:"Winter", year:2024, isActive:true,  professorId:"p4", aiInstructions:"", description:"Classical, nonparametric and robust inferences about means, variances, and analysis of variance." },
];

const _COURSE_COLORS = [
  "oklch(0.56 0.20 255)","oklch(0.56 0.18 145)","oklch(0.60 0.18 300)",
  "oklch(0.58 0.18 48)", "oklch(0.55 0.16 25)", "oklch(0.52 0.17 210)",
];
const _courseColor = code => _COURSE_COLORS[[...code].reduce((h,c)=>c.charCodeAt(0)+((h<<5)-h),0) & 7 % _COURSE_COLORS.length];

const _ROLE_ACTIONS = {
  ADMIN:     ["edit","delete"],
  PROFESSOR: ["edit"],
  TA:        ["view"],
  STUDENT:   ["view"],
};

function CoursesSiteHeader({ role, onAdd }) {
  return (
    <div style={{ height:"56px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", padding:"0 28px", justifyContent:"space-between", flexShrink:0, background:"var(--background)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:"6px", fontSize:"13px", color:"var(--muted-foreground)" }}>
        <span>Home</span><span style={{ color:"var(--border)" }}>/</span>
        <span style={{ color:"var(--foreground)", fontWeight:500 }}>Courses</span>
      </div>
      {role === "ADMIN" && (
        <button onClick={onAdd} style={{ display:"flex", alignItems:"center", gap:"7px", padding:"7px 14px", fontSize:"13px", fontWeight:500, background:"oklch(0.192 0.055 259)", color:"#fff", border:"none", borderRadius:"var(--radius-lg)", cursor:"pointer", fontFamily:"var(--font-sans)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Create Course
        </button>
      )}
    </div>
  );
}

function CourseCard({ course, role, myId, onView }) {
  const actions = _ROLE_ACTIONS[role] || ["view"];
  const isProfOwn = role === "PROFESSOR" && course.professorId === "p1"; /* demo: p1 = logged-in prof */
  const showEdit   = actions.includes("edit") && (role === "ADMIN" || isProfOwn);
  const showDelete = actions.includes("delete");
  const color = _courseColor(course.code);

  return (
    <div onClick={onView} style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-xl)", overflow:"hidden", cursor:"pointer", transition:"box-shadow 150ms, transform 150ms", boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow="0 6px 20px rgba(0,0,0,0.10)"; e.currentTarget.style.transform="translateY(-1px)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow="0 1px 3px rgba(0,0,0,0.06)"; e.currentTarget.style.transform="none"; }}>
      {/* Color top bar */}
      <div style={{ height:"4px", background:color }} />
      <div style={{ padding:"16px 18px" }}>
        {/* Header row */}
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:"8px" }}>
          <div>
            <div style={{ fontSize:"16px", fontWeight:700, color:"var(--foreground)" }}>{course.code}</div>
            <div style={{ fontSize:"13px", color:"var(--muted-foreground)", marginTop:"2px", lineHeight:1.3 }}>{course.name}</div>
          </div>
          <div style={{ display:"flex", gap:"6px", flexShrink:0, marginLeft:"10px" }} onClick={e => e.stopPropagation()}>
            {showEdit && (
              <button style={{ width:"30px", height:"30px", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            )}
            {showDelete && (
              <button style={{ width:"30px", height:"30px", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--destructive)" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>
            )}
            {!showEdit && !showDelete && (
              <button style={{ width:"30px", height:"30px", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div style={{ display:"flex", alignItems:"center", gap:"10px", marginTop:"10px", flexWrap:"wrap" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"4px", fontSize:"12px", color:"var(--muted-foreground)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            {course.term} {course.year}
          </div>
          <span style={{ fontSize:"11px", fontWeight:600, padding:"2px 8px", borderRadius:"999px", background: course.isActive ? "var(--color-success-100)" : "var(--muted)", color: course.isActive ? "var(--color-success-700)" : "var(--muted-foreground)" }}>
            {course.isActive ? "Active" : "Inactive"}
          </span>
        </div>

        {/* AI instructions snippet */}
        {course.aiInstructions && (
          <div style={{ marginTop:"10px", padding:"8px 10px", background:"var(--muted)", borderRadius:"var(--radius-md)", fontSize:"11px", color:"var(--muted-foreground)", lineHeight:1.5 }}>
            <span style={{ fontWeight:600 }}>AI: </span>
            {course.aiInstructions.length > 80 ? course.aiInstructions.slice(0,80)+"…" : course.aiInstructions}
          </div>
        )}
      </div>
    </div>
  );
}

function Courses({ user, onNavigate }) {
  const role = user?.role || "STUDENT";
  const [showCreate, setShowCreate] = React.useState(false);

  const subtitle = role === "ADMIN" ? "Manage all courses in the system"
                 : role === "PROFESSOR" ? "View and manage your courses"
                 : "View your enrolled courses";

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", fontFamily:"var(--font-sans)", background:"oklch(0.976 0 0)" }}>
      <CoursesSiteHeader role={role} onAdd={() => setShowCreate(true)} />

      <div style={{ flex:1, overflowY:"auto", padding:"28px" }}>
        <div style={{ marginBottom:"20px" }}>
          <h1 style={{ fontSize:"24px", fontWeight:700, color:"var(--foreground)", margin:"0 0 5px" }}>Courses</h1>
          <div style={{ width:"32px", height:"3px", background:"#FFD100", borderRadius:"2px", marginBottom:"8px" }} />
          <p style={{ fontSize:"13px", color:"var(--muted-foreground)", margin:0 }}>{subtitle}</p>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:"16px" }}>
          {_COURSES_DATA.map(c => (
            <CourseCard key={c.id} course={c} role={role} onView={() => onNavigate("courseDetail")} />
          ))}
        </div>
      </div>

      {/* Create Course Dialog */}
      {showCreate && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:50, display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={() => setShowCreate(false)}>
          <div style={{ background:"var(--card)", borderRadius:"var(--radius-xl)", border:"1px solid var(--border)", padding:"28px 32px", width:"460px", boxShadow:"0 16px 48px rgba(0,0,0,0.18)" }}
            onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize:"18px", fontWeight:700, color:"var(--foreground)", margin:"0 0 4px" }}>Create New Course</h2>
            <p style={{ fontSize:"13px", color:"var(--muted-foreground)", margin:"0 0 20px" }}>Create a new course for the current academic term.</p>
            <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
              {[["Course Name","text","Introduction to Computer Science"],["Course Code","text","CS 101"]].map(([label,type,ph]) => (
                <div key={label} style={{ display:"flex", flexDirection:"column", gap:"5px" }}>
                  <label style={{ fontSize:"13px", fontWeight:500, color:"var(--foreground)" }}>{label}</label>
                  <input type={type} placeholder={ph} style={{ padding:"8px 12px", fontSize:"13px", fontFamily:"var(--font-sans)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", background:"var(--background)", color:"var(--foreground)", outline:"none" }} />
                </div>
              ))}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px" }}>
                <div style={{ display:"flex", flexDirection:"column", gap:"5px" }}>
                  <label style={{ fontSize:"13px", fontWeight:500, color:"var(--foreground)" }}>Term</label>
                  <select style={{ padding:"8px 12px", fontSize:"13px", fontFamily:"var(--font-sans)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", background:"var(--background)", color:"var(--foreground)" }}>
                    {["Fall","Winter","Summer"].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:"5px" }}>
                  <label style={{ fontSize:"13px", fontWeight:500, color:"var(--foreground)" }}>Year</label>
                  <input type="number" defaultValue={2024} style={{ padding:"8px 12px", fontSize:"13px", fontFamily:"var(--font-sans)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", background:"var(--background)", color:"var(--foreground)", outline:"none" }} />
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:"5px" }}>
                <label style={{ fontSize:"13px", fontWeight:500, color:"var(--foreground)" }}>AI Instructions</label>
                <textarea placeholder="Instructions for AI assistant behavior in this course…" rows={3} style={{ padding:"8px 12px", fontSize:"13px", fontFamily:"var(--font-sans)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", background:"var(--background)", color:"var(--foreground)", outline:"none", resize:"vertical" }} />
              </div>
            </div>
            <div style={{ display:"flex", gap:"10px", marginTop:"22px", justifyContent:"flex-end" }}>
              <button onClick={() => setShowCreate(false)} style={{ padding:"8px 18px", fontSize:"13px", fontWeight:500, background:"transparent", color:"var(--foreground)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", cursor:"pointer", fontFamily:"var(--font-sans)" }}>Cancel</button>
              <button onClick={() => setShowCreate(false)} style={{ padding:"8px 18px", fontSize:"13px", fontWeight:500, background:"oklch(0.192 0.055 259)", color:"#fff", border:"none", borderRadius:"var(--radius-lg)", cursor:"pointer", fontFamily:"var(--font-sans)" }}>Create Course</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.Courses = Courses;
