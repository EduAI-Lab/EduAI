/* CourseDetail.jsx — matches courses.$courseId.tsx: tabs = Overview / Materials / Chat */

const _CD_COURSE = {
  id: "1", code: "CPSC 110", name: "Computation, Programs, and Programming",
  term: "Fall", year: 2024, isActive: true,
  description: "Systematic program design using the functional core of a modern object-oriented language. Design recipes, abstraction, testing, and program decomposition.",
  aiInstructions: "Focus on functional programming concepts and design recipes. Emphasize HtDF and HtDW design patterns. Help students understand recursion and data-directed design.",
  professor: { name: "Prof. Gregor Kiczales", email: "kiczales@cs.ubc.ca" },
};

const _CD_MATERIALS = [
  { name:"Week 1 — Introduction to BSL.pdf",    type:"pdf",  size:"2.4 MB", date:"Sep 4",  embedded:true  },
  { name:"Week 2 — Data Definitions.pdf",        type:"pdf",  size:"3.1 MB", date:"Sep 11", embedded:true  },
  { name:"Week 3 — How to Design Functions.pdf", type:"pdf",  size:"1.9 MB", date:"Sep 18", embedded:true  },
  { name:"Midterm Review Slides.pptx",           type:"pptx", size:"5.6 MB", date:"Oct 2",  embedded:false },
  { name:"Lab 1 — DrRacket Setup.pdf",           type:"pdf",  size:"0.8 MB", date:"Sep 6",  embedded:true  },
];

const CD_TABS = ["Overview", "Materials", "Chat"];

function CDSiteHeader({ onBack, course }) {
  return (
    <div style={{ height:"56px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", padding:"0 28px", justifyContent:"space-between", flexShrink:0, background:"var(--background)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:"6px", fontSize:"13px", color:"var(--muted-foreground)" }}>
        <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--muted-foreground)", fontFamily:"var(--font-sans)", fontSize:"13px", padding:0 }}>Home</button>
        <span style={{ color:"var(--border)" }}>/</span>
        <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--muted-foreground)", fontFamily:"var(--font-sans)", fontSize:"13px", padding:0 }}>Courses</button>
        <span style={{ color:"var(--border)" }}>/</span>
        <span style={{ color:"var(--foreground)", fontWeight:500 }}>{course.code}</span>
      </div>
      <div style={{ display:"flex", gap:"8px" }}>
        <button style={{ display:"flex", alignItems:"center", gap:"5px", padding:"6px 13px", fontSize:"13px", fontWeight:500, background:"transparent", color:"var(--foreground)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", cursor:"pointer", fontFamily:"var(--font-sans)" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          View Students
        </button>
      </div>
    </div>
  );
}

function CDTabBar({ active, onSelect }) {
  return (
    <div style={{ display:"flex", borderBottom:"1px solid var(--border)", padding:"0 28px", background:"var(--background)", flexShrink:0 }}>
      {CD_TABS.map(tab => (
        <button key={tab} onClick={() => onSelect(tab)} style={{
          padding:"12px 18px", fontSize:"14px",
          fontWeight: active === tab ? 500 : 400,
          color: active === tab ? "var(--foreground)" : "var(--muted-foreground)",
          background:"none", border:"none", cursor:"pointer",
          borderBottom: active === tab ? "2px solid oklch(0.192 0.055 259)" : "2px solid transparent",
          marginBottom:"-1px", fontFamily:"var(--font-sans)", transition:"color 120ms",
        }}>{tab}</button>
      ))}
    </div>
  );
}

function CDOverview({ user }) {
  const c = _CD_COURSE;
  const canManage = user?.role === "ADMIN" || user?.role === "PROFESSOR";
  return (
    <div style={{ padding:"28px", display:"flex", flexDirection:"column", gap:"16px" }}>
      {/* Hero card */}
      <div style={{ background:"linear-gradient(135deg, oklch(0.192 0.055 259) 0%, oklch(0.42 0.14 232) 100%)", borderRadius:"var(--radius-xl)", padding:"24px 28px", color:"#fff" }}>
        <div style={{ fontSize:"11px", opacity:0.7, marginBottom:"5px", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>CPSC · {c.term} {c.year}</div>
        <h1 style={{ fontSize:"20px", fontWeight:700, margin:"0 0 8px", lineHeight:1.2 }}>{c.code}: {c.name}</h1>
        <p style={{ fontSize:"13px", opacity:0.85, margin:0, lineHeight:1.55, maxWidth:"560px" }}>{c.description}</p>
        <div style={{ display:"flex", gap:"8px", marginTop:"16px" }}>
          <span style={{ fontSize:"11px", fontWeight:600, padding:"3px 10px", borderRadius:"999px", background:"rgba(255,255,255,0.2)" }}>● Active</span>
          <span style={{ fontSize:"11px", fontWeight:600, padding:"3px 10px", borderRadius:"999px", background:"rgba(255,255,255,0.2)" }}>AI-enabled</span>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"16px" }}>
        {/* Course info */}
        <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-xl)", padding:"20px 22px" }}>
          <h2 style={{ fontSize:"14px", fontWeight:600, color:"var(--foreground)", margin:"0 0 14px", display:"flex", alignItems:"center", gap:"7px" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.75" strokeLinecap="round"><path d="M4 19V7.5a3.5 3.5 0 0 1 7 0V19M11 7.5a3.5 3.5 0 0 1 7 0V19M4 19h16"/></svg>
            Course Information
          </h2>
          <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
            {[["Term", `${c.term} ${c.year}`], ["Status", c.isActive ? "Active" : "Inactive"]].map(([k,v]) => (
              <div key={k}>
                <div style={{ fontSize:"12px", fontWeight:600, color:"var(--muted-foreground)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:"2px" }}>{k}</div>
                <div style={{ fontSize:"14px", color:"var(--foreground)" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Instructor */}
        <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-xl)", padding:"20px 22px" }}>
          <h2 style={{ fontSize:"14px", fontWeight:600, color:"var(--foreground)", margin:"0 0 14px", display:"flex", alignItems:"center", gap:"7px" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.75" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Instructor
          </h2>
          <div style={{ display:"flex", alignItems:"center", gap:"11px" }}>
            <div style={{ width:"40px", height:"40px", borderRadius:"9px", background:"oklch(0.192 0.055 259)", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:700, fontSize:"14px", flexShrink:0 }}>GK</div>
            <div>
              <div style={{ fontSize:"14px", fontWeight:600, color:"var(--foreground)" }}>{c.professor.name}</div>
              <div style={{ fontSize:"12px", color:"var(--muted-foreground)" }}>{c.professor.email}</div>
            </div>
          </div>
        </div>
      </div>

      {/* AI Instructions */}
      {c.aiInstructions && (
        <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-xl)", padding:"20px 22px" }}>
          <h2 style={{ fontSize:"14px", fontWeight:600, color:"var(--foreground)", margin:"0 0 10px", display:"flex", alignItems:"center", gap:"7px" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.75" strokeLinecap="round"><path d="M12 8V4M8 4h8M7 8h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"/><path d="M9 13h.01M15 13h.01"/></svg>
            AI Instructions
          </h2>
          <p style={{ fontSize:"13px", color:"var(--muted-foreground)", margin:0, lineHeight:1.6 }}>{c.aiInstructions}</p>
        </div>
      )}
    </div>
  );
}

function CDMaterials({ user }) {
  const canManage = user?.role === "ADMIN" || user?.role === "PROFESSOR";
  return (
    <div style={{ padding:"28px" }}>
      {canManage ? (
        <>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"16px" }}>
            <div>
              <h2 style={{ fontSize:"16px", fontWeight:600, color:"var(--foreground)", margin:"0 0 3px" }}>Course Materials</h2>
              <p style={{ fontSize:"13px", color:"var(--muted-foreground)", margin:0 }}>{_CD_MATERIALS.length} files · {_CD_MATERIALS.filter(m=>m.embedded).length} embedded in AI</p>
            </div>
            <button style={{ display:"flex", alignItems:"center", gap:"7px", padding:"7px 14px", fontSize:"13px", fontWeight:500, background:"oklch(0.192 0.055 259)", color:"#fff", border:"none", borderRadius:"var(--radius-lg)", cursor:"pointer", fontFamily:"var(--font-sans)" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Upload File
            </button>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
            {_CD_MATERIALS.map((f,i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:"12px", padding:"12px 16px", background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)" }}>
                <div style={{ width:"32px", height:"32px", borderRadius:"7px", flexShrink:0, background: f.type==="pdf"?"oklch(0.63 0.22 25)":"oklch(0.55 0.18 48)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:"13px", fontWeight:500, color:"var(--foreground)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</div>
                  <div style={{ fontSize:"11px", color:"var(--muted-foreground)", marginTop:"2px" }}>{f.size} · Uploaded {f.date}</div>
                </div>
                <span style={{ fontSize:"10px", fontWeight:700, padding:"2px 8px", borderRadius:"999px", background: f.embedded?"var(--color-success-100)":"var(--muted)", color: f.embedded?"var(--color-success-700)":"var(--muted-foreground)" }}>
                  {f.embedded?"Embedded":"Not embedded"}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"60px 20px", textAlign:"center" }}>
          <div style={{ width:"56px", height:"56px", borderRadius:"14px", background:"var(--muted)", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:"14px" }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" strokeLinecap="round"><path d="M4 19V7.5a3.5 3.5 0 0 1 7 0V19M11 7.5a3.5 3.5 0 0 1 7 0V19M4 19h16"/></svg>
          </div>
          <div style={{ fontSize:"15px", fontWeight:600, color:"var(--foreground)", marginBottom:"5px" }}>Course materials are managed by your professor</div>
          <p style={{ fontSize:"13px", color:"var(--muted-foreground)", margin:0 }}>Only professors and administrators can upload or manage course materials.</p>
        </div>
      )}
    </div>
  );
}

function CDChat({ onNavigateToChatbot }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"60px 20px", textAlign:"center" }}>
      <div style={{ width:"60px", height:"60px", borderRadius:"14px", background:"oklch(0.192 0.055 259 / 0.08)", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:"16px" }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="oklch(0.192 0.055 259)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 8V4M8 4h8M7 8h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"/><path d="M9 13h.01M15 13h.01"/></svg>
      </div>
      <h2 style={{ fontSize:"16px", fontWeight:600, color:"var(--foreground)", margin:"0 0 8px" }}>Chat about this course with AI</h2>
      <p style={{ fontSize:"13px", color:"var(--muted-foreground)", maxWidth:"360px", lineHeight:1.6, margin:"0 0 20px" }}>
        Use the main Chatbot to ask questions about CPSC 110 materials. Select this course from the course selector in the chat input.
      </p>
      <button onClick={onNavigateToChatbot} style={{ padding:"9px 20px", fontSize:"13px", fontWeight:500, background:"oklch(0.192 0.055 259)", color:"#fff", border:"none", borderRadius:"var(--radius-lg)", cursor:"pointer", fontFamily:"var(--font-sans)" }}>
        Go to Chatbot
      </button>
    </div>
  );
}

function CourseDetail({ onBack, onNavigateToChatbot, user }) {
  const [tab, setTab] = React.useState("Overview");
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", fontFamily:"var(--font-sans)", background:"oklch(0.976 0 0)" }}>
      <CDSiteHeader onBack={onBack} course={_CD_COURSE} />
      <CDTabBar active={tab} onSelect={setTab} />
      <div style={{ flex:1, overflowY:"auto" }}>
        {tab === "Overview"   && <CDOverview user={user} />}
        {tab === "Materials"  && <CDMaterials user={user} />}
        {tab === "Chat"       && <CDChat onNavigateToChatbot={onNavigateToChatbot} />}
      </div>
    </div>
  );
}

window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.CourseDetail = CourseDetail;
