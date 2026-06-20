/* Dashboard.jsx — rich 2-col layout, hero, stats, course shortcuts, activity */

const _DASH_COURSES = [
  { code:"CPSC 110", name:"Computation, Programs, and Programming", term:"Fall 2024", professor:"Prof. G. Kiczales",   color:"oklch(0.56 0.20 255)" },
  { code:"MATH 200", name:"Calculus III",                           term:"Fall 2024", professor:"Prof. A. Thompson",  color:"oklch(0.56 0.18 145)" },
  { code:"PHYS 101", name:"Energy and Waves",                       term:"Fall 2024", professor:"Prof. L. Zhang",     color:"oklch(0.60 0.18 300)" },
];

const _CONVOS = [
  { course:"CPSC 110", q:"What is tail recursion and why is it important for functional programming?", ago:"2h ago" },
  { course:"MATH 200", q:"Explain the gradient theorem and when to apply it",                           ago:"Yesterday" },
  { course:"CPSC 110", q:"How do I implement a binary search tree in Racket?",                         ago:"2 days ago" },
];

const _ADMIN_STATS = [
  { label:"Total Users",    value:"1,248",  trend:"+12",  up:true  },
  { label:"Active Courses", value:"47",     trend:"+3",   up:true  },
  { label:"AI Sessions",    value:"8,391",  trend:"+24%", up:true  },
  { label:"Storage Used",   value:"12.4 GB",trend:"+5%",  up:true  },
];
const _PROF_STATS = [
  { label:"Courses Teaching",   value:"3",   trend:"",     up:true  },
  { label:"Students Enrolled",  value:"312", trend:"+18",  up:true  },
  { label:"Materials Uploaded", value:"24",  trend:"+6",   up:true  },
  { label:"AI Interactions",    value:"891", trend:"+33%", up:true  },
];
const _STUDENT_STATS = [
  { label:"Courses Enrolled",   value:"3",   trend:"",     up:true  },
  { label:"AI Sessions / Week", value:"12",  trend:"+33%", up:true  },
  { label:"Materials Accessed", value:"47",  trend:"+8%",  up:true  },
  { label:"Avg. Quiz Score",    value:"84%", trend:"-2%",  up:false },
];

function DashSiteHeader({ breadcrumbs }) {
  return (
    <div style={{ height:"56px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", padding:"0 28px", justifyContent:"space-between", flexShrink:0, background:"var(--background)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:"6px", fontSize:"13px", color:"var(--muted-foreground)" }}>
        {breadcrumbs.map((b, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color:"var(--border)" }}>/</span>}
            <span style={{ color: i === breadcrumbs.length-1 ? "var(--foreground)" : undefined, fontWeight: i === breadcrumbs.length-1 ? 500 : 400 }}>{b}</span>
          </React.Fragment>
        ))}
      </div>
      <div style={{ fontSize:"11px", fontWeight:600, padding:"3px 10px", borderRadius:"999px", background:"oklch(0.192 0.055 259)", color:"#fff", letterSpacing:"0.02em" }}>
        UBC · Student Portal
      </div>
    </div>
  );
}

function StatCard({ label, value, trend, up }) {
  return (
    <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-xl)", padding:"18px 20px", boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
      <div style={{ fontSize:"12px", color:"var(--muted-foreground)", marginBottom:"8px", fontWeight:500 }}>{label}</div>
      <div style={{ fontSize:"26px", fontWeight:700, color:"var(--foreground)", lineHeight:1 }}>{value}</div>
      {trend && (
        <div style={{ marginTop:"8px", display:"inline-flex", alignItems:"center", gap:"3px", fontSize:"11px", fontWeight:600, padding:"2px 7px", borderRadius:"999px",
          background: up ? "var(--color-success-100)" : "var(--color-error-100)",
          color:       up ? "var(--color-success-700)" : "var(--color-error-700)",
        }}>
          {up ? "↑" : "↓"} {trend}
        </div>
      )}
    </div>
  );
}

function Dashboard({ user, onNavigate }) {
  const role = user?.role || "STUDENT";
  const name = (user?.name || "").split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const stats = role === "ADMIN" ? _ADMIN_STATS : role === "PROFESSOR" ? _PROF_STATS : _STUDENT_STATS;

  const heroTitle = role === "ADMIN" ? "Platform Overview"
                  : role === "PROFESSOR" ? `Welcome back, ${name}.`
                  : `${greeting}, ${name}.`;

  const heroSub = role === "ADMIN" ? "EduAI platform health and usage at a glance."
                : role === "PROFESSOR" ? "Your courses and teaching activity."
                : "Your AI-powered learning companion.";

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric", year:"numeric" });

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", fontFamily:"var(--font-sans)", background:"oklch(0.976 0 0)" }}>
      <DashSiteHeader breadcrumbs={["Home", "Dashboard"]} />

      <div style={{ flex:1, overflowY:"auto", padding:"28px" }}>

        {/* Welcome hero */}
        <div style={{ marginBottom:"24px" }}>
          <h1 style={{ fontSize:"28px", fontWeight:700, color:"var(--foreground)", margin:"0 0 10px", lineHeight:1.1 }}>{heroTitle}</h1>
          <div style={{ width:"40px", height:"3px", background:"#FFD100", borderRadius:"2px", marginBottom:"10px" }} />
          <p style={{ fontSize:"14px", color:"var(--muted-foreground)", margin:0 }}>{dateStr} · {heroSub}</p>
        </div>

        {/* Stat cards */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:"14px", marginBottom:"24px" }}>
          {stats.map(s => <StatCard key={s.label} {...s} />)}
        </div>

        {/* 2-column layout */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 380px", gap:"20px" }}>

          {/* Left: Your Courses */}
          <div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"14px" }}>
              <h2 style={{ fontSize:"15px", fontWeight:600, color:"var(--foreground)", margin:0 }}>
                {role === "ADMIN" ? "Quick Actions" : "Your Courses"}
              </h2>
              {role !== "ADMIN" && (
                <button onClick={() => onNavigate("courses")} style={{ fontSize:"12px", color:"oklch(0.47 0.17 258)", fontWeight:500, background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font-sans)" }}>
                  Browse all →
                </button>
              )}
            </div>

            {role === "ADMIN" ? (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px" }}>
                {[
                  { label:"Add User",      desc:"Create a new user account",     icon:"users",   action:"admin-users", color:"oklch(0.56 0.20 255)" },
                  { label:"Create Course", desc:"Set up a new course with AI",   icon:"books",   action:"courses",     color:"oklch(0.56 0.18 145)" },
                  { label:"AI Settings",   desc:"Manage models and providers",   icon:"brain",   action:"admin-ai",    color:"oklch(0.60 0.18 300)" },
                  { label:"View Reports",  desc:"Bug reports and system logs",   icon:"report",  action:"reports",     color:"oklch(0.58 0.18 48)"  },
                ].map(a => (
                  <button key={a.label} onClick={() => onNavigate(a.action)} style={{ display:"flex", alignItems:"flex-start", gap:"12px", padding:"16px", background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-xl)", cursor:"pointer", boxShadow:"0 1px 3px rgba(0,0,0,0.05)", textAlign:"left", fontFamily:"var(--font-sans)", transition:"box-shadow 150ms" }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow="0 4px 12px rgba(0,0,0,0.10)"}
                    onMouseLeave={e => e.currentTarget.style.boxShadow="0 1px 3px rgba(0,0,0,0.05)"}>
                    <div style={{ width:"36px", height:"36px", borderRadius:"8px", background:a.color+"22", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={a.color} strokeWidth="1.75" strokeLinecap="round">
                        {(_SB_ICONS_DASH[a.icon]||[]).map((d,i)=><path key={i} d={d}/>)}
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize:"13px", fontWeight:600, color:"var(--foreground)" }}>{a.label}</div>
                      <div style={{ fontSize:"12px", color:"var(--muted-foreground)", marginTop:"2px", lineHeight:1.4 }}>{a.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-xl)", overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
                {_DASH_COURSES.map((c, i) => (
                  <div key={c.code} style={{ display:"flex", alignItems:"center", gap:"14px", padding:"14px 18px", borderBottom: i < _DASH_COURSES.length-1 ? "1px solid var(--border)" : "none" }}>
                    <div style={{ width:"4px", height:"44px", borderRadius:"2px", background:c.color, flexShrink:0 }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                        <span style={{ fontSize:"14px", fontWeight:600, color:"var(--foreground)" }}>{c.code}</span>
                        <span style={{ fontSize:"11px", color:"var(--muted-foreground)" }}>{c.term}</span>
                      </div>
                      <div style={{ fontSize:"12px", color:"var(--muted-foreground)", marginTop:"2px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.name}</div>
                    </div>
                    <button onClick={() => onNavigate("chatbot")} style={{ padding:"6px 12px", fontSize:"12px", fontWeight:500, background:"oklch(0.192 0.055 259)", color:"#fff", border:"none", borderRadius:"var(--radius-md)", cursor:"pointer", fontFamily:"var(--font-sans)", whiteSpace:"nowrap" }}>
                      Chat →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Recent conversations */}
          <div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"14px" }}>
              <h2 style={{ fontSize:"15px", fontWeight:600, color:"var(--foreground)", margin:0 }}>Recent Conversations</h2>
              <button onClick={() => onNavigate("chatbot")} style={{ fontSize:"12px", color:"oklch(0.47 0.17 258)", fontWeight:500, background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font-sans)" }}>
                New chat →
              </button>
            </div>
            <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-xl)", overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
              {_CONVOS.map((c, i) => (
                <div key={i} style={{ padding:"14px 18px", borderBottom: i < _CONVOS.length-1 ? "1px solid var(--border)" : "none", cursor:"pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background="oklch(0.976 0 0)"}
                  onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"5px" }}>
                    <span style={{ fontSize:"11px", fontWeight:700, color:"oklch(0.192 0.055 259)", padding:"1px 7px", borderRadius:"999px", background:"oklch(0.192 0.055 259 / 0.08)" }}>{c.course}</span>
                    <span style={{ fontSize:"11px", color:"var(--muted-foreground)" }}>{c.ago}</span>
                  </div>
                  <p style={{ fontSize:"13px", color:"var(--foreground)", margin:0, lineHeight:1.4, display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden" }}>"{c.q}"</p>
                </div>
              ))}
              <div style={{ padding:"12px 18px", background:"oklch(0.976 0 0)" }}>
                <button onClick={() => onNavigate("chatbot")} style={{ fontSize:"13px", fontWeight:500, color:"oklch(0.192 0.055 259)", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font-sans)", padding:0 }}>
                  + Start a new conversation
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* icon paths used by admin quick-action cards */
const _SB_ICONS_DASH = {
  users:  ["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2","M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z","M23 21v-2a4 4 0 0 0-3-3.87","M16 3.13a4 4 0 0 1 0 7.75"],
  books:  ["M4 19V7.5a3.5 3.5 0 0 1 7 0V19","M11 7.5a3.5 3.5 0 0 1 7 0V19","M4 19h16"],
  brain:  ["M9.5 2a2.5 2.5 0 1 1 5 0","M4 9.5a2.5 2.5 0 1 1 5 0","M15 9.5a2.5 2.5 0 1 1 5 0","M12 4.5v5","M6.5 12l3.5-2.5","M17.5 12l-3.5-2.5","M6.5 12a5.5 5.5 0 0 0 11 0"],
  report: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z","M14 2v6h6","M16 13H8","M16 17H8","M10 9H8"],
};

window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.Dashboard = Dashboard;
