/* AdminUsers.jsx — user management data table (ADMIN role) */

const USERS = [
  { name: "Dr. Sandra Hobbes",  email: "s.hobbes@ubc.ca",            role: "ADMIN",      dept: "Computer Science",  active: true,  joined: "Jan 2024" },
  { name: "Prof. Gregor K.",    email: "kiczales@cs.ubc.ca",         role: "PROFESSOR", dept: "Computer Science",  active: true,  joined: "Jan 2024" },
  { name: "Prof. Sarah Chen",   email: "s.chen@math.ubc.ca",         role: "PROFESSOR", dept: "Mathematics",       active: true,  joined: "Feb 2024" },
  { name: "Tom Walker",         email: "t.walker@ta.ubc.ca",         role: "TA",         dept: "Computer Science",  active: true,  joined: "Sep 2024" },
  { name: "Alex Chen",          email: "alex.chen@student.ubc.ca",   role: "STUDENT",    dept: "Computer Science",  active: true,  joined: "Sep 2024" },
  { name: "Maria Santos",       email: "m.santos@student.ubc.ca",    role: "STUDENT",    dept: "Mathematics",       active: true,  joined: "Sep 2024" },
  { name: "James Liu",          email: "jliu@student.ubc.ca",        role: "STUDENT",    dept: "Physics",           active: false, joined: "Sep 2024" },
  { name: "Priya Sharma",       email: "p.sharma@student.ubc.ca",    role: "STUDENT",    dept: "Computer Science",  active: true,  joined: "Oct 2024" },
];

const ROLE_STYLE = {
  ADMIN:      { label: "Admin",      bg: "var(--color-role-admin)"      },
  UNIT_ADMIN: { label: "Unit Admin", bg: "var(--color-role-unit-admin)" },
  PROFESSOR:  { label: "Professor",  bg: "var(--color-role-instructor)" },
  TA:         { label: "TA",         bg: "var(--color-role-ta)"         },
  STUDENT:    { label: "Student",    bg: "var(--color-role-student)"    },
};

function RoleBadge({ role }) {
  const r = ROLE_STYLE[role] || ROLE_STYLE.STUDENT;
  return (
    <span style={{
      fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "999px",
      background: r.bg, color: "#fff",
    }}>{r.label}</span>
  );
}

function AdminUsers() {
  const [search, setSearch] = React.useState("");
  const [filterRole, setFilterRole] = React.useState("All");
  const [showDialog, setShowDialog] = React.useState(false);

  const filtered = USERS.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = filterRole === "All" || u.role === filterRole;
    return matchSearch && matchRole;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "var(--font-sans)", background: "var(--background)" }}>

      {/* Site Header */}
      <div style={{
        height: "56px", borderBottom: "1px solid var(--border)", flexShrink: 0,
        display: "flex", alignItems: "center", padding: "0 24px",
        justifyContent: "space-between", background: "var(--background)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--muted-foreground)" }}>
          <span>Home</span><span style={{ color: "var(--border)" }}>/</span>
          <span>Admin</span><span style={{ color: "var(--border)" }}>/</span>
          <span style={{ color: "var(--foreground)", fontWeight: 500 }}>Users</span>
        </div>
        <button onClick={() => setShowDialog(true)} style={{
          display: "flex", alignItems: "center", gap: "7px",
          padding: "7px 14px", fontSize: "13px", fontWeight: 500,
          background: "var(--primary)", color: "var(--primary-foreground)",
          border: "none", borderRadius: "var(--radius-base)", cursor: "pointer", fontFamily: "var(--font-sans)",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Add User
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
        {/* Page title */}
        <div style={{ marginBottom: "20px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--foreground)", margin: "0 0 5px" }}>User Management</h1>
          <p style={{ fontSize: "14px", color: "var(--muted-foreground)", margin: 0 }}>{USERS.length} total users · {USERS.filter(u => u.active).length} active</p>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            style={{
              padding: "7px 12px", fontSize: "13px", fontFamily: "var(--font-sans)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-base)",
              background: "var(--input)", color: "var(--foreground)", outline: "none", width: "260px",
            }}
          />
          <select
            value={filterRole} onChange={e => setFilterRole(e.target.value)}
            style={{
              padding: "7px 12px", fontSize: "13px", fontFamily: "var(--font-sans)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-base)",
              background: "var(--input)", color: "var(--foreground)", cursor: "pointer",
            }}
          >
            {["All", "ADMIN", "PROFESSOR", "TA", "STUDENT"].map(r => (
              <option key={r} value={r}>{r === "All" ? "All roles" : ROLE_STYLE[r]?.label || r}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ background: "var(--muted)" }}>
                {["User", "Role", "Department", "Status", "Joined", ""].map((h, i) => (
                  <th key={i} style={{
                    padding: "10px 14px", textAlign: "left", fontWeight: 600,
                    color: "var(--muted-foreground)", fontSize: "11px",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                    borderBottom: "1px solid var(--border)",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "var(--card)" : "var(--background)" }}>
                  <td style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{
                        width: "32px", height: "32px", borderRadius: "7px", flexShrink: 0,
                        background: `oklch(0.42 0.14 ${[...u.name].reduce((h, c) => c.charCodeAt(0) + ((h << 5) - h), 0) % 360})`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", fontWeight: 700, fontSize: "11px",
                      }}>
                        {u.name.split(" ").map(p => p[0]).join("").slice(0, 2)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500, color: "var(--foreground)" }}>{u.name}</div>
                        <div style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
                    <RoleBadge role={u.role} />
                  </td>
                  <td style={{ padding: "12px 14px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>{u.dept}</td>
                  <td style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: "5px",
                      fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "999px",
                      background: u.active ? "var(--color-success-100)" : "var(--muted)",
                      color: u.active ? "var(--color-success-700)" : "var(--muted-foreground)",
                    }}>
                      <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: u.active ? "var(--color-success-500)" : "var(--muted-foreground)" }} />
                      {u.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 14px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>{u.joined}</td>
                  <td style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button style={{
                        padding: "4px 10px", fontSize: "12px", background: "transparent",
                        border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                        color: "var(--foreground)", cursor: "pointer", fontFamily: "var(--font-sans)",
                      }}>Edit</button>
                      <button style={{
                        padding: "4px 10px", fontSize: "12px", background: "transparent",
                        border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                        color: "var(--destructive)", cursor: "pointer", fontFamily: "var(--font-sans)",
                      }}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create user dialog */}
      {showDialog && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowDialog(false)}>
          <div style={{
            background: "var(--card)", borderRadius: "var(--radius-xl)",
            border: "1px solid var(--border)", padding: "28px 32px",
            width: "440px", boxShadow: "var(--shadow-xl)",
          }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--foreground)", margin: "0 0 20px" }}>Add New User</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {[["Full name", "text", "Dr. Jane Smith"], ["Email", "email", "jane@ubc.ca"]].map(([label, type, ph]) => (
                <div key={label} style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  <label style={{ fontSize: "13px", fontWeight: 500, color: "var(--foreground)" }}>{label}</label>
                  <input type={type} placeholder={ph} style={{
                    padding: "8px 12px", fontSize: "13px", fontFamily: "var(--font-sans)",
                    border: "1px solid var(--border)", borderRadius: "var(--radius-base)",
                    background: "var(--input)", color: "var(--foreground)", outline: "none",
                  }} />
                </div>
              ))}
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                <label style={{ fontSize: "13px", fontWeight: 500, color: "var(--foreground)" }}>Role</label>
                <select style={{
                  padding: "8px 12px", fontSize: "13px", fontFamily: "var(--font-sans)",
                  border: "1px solid var(--border)", borderRadius: "var(--radius-base)",
                  background: "var(--input)", color: "var(--foreground)",
                }}>
                  {["STUDENT", "TA", "PROFESSOR", "ADMIN"].map(r => (
                    <option key={r} value={r}>{ROLE_STYLE[r]?.label || r}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button onClick={() => setShowDialog(false)} style={{
                padding: "8px 18px", fontSize: "13px", fontWeight: 500,
                background: "transparent", color: "var(--foreground)", border: "1px solid var(--border)",
                borderRadius: "var(--radius-base)", cursor: "pointer", fontFamily: "var(--font-sans)",
              }}>Cancel</button>
              <button onClick={() => setShowDialog(false)} style={{
                padding: "8px 18px", fontSize: "13px", fontWeight: 500,
                background: "var(--primary)", color: "var(--primary-foreground)",
                border: "none", borderRadius: "var(--radius-base)", cursor: "pointer", fontFamily: "var(--font-sans)",
              }}>Create User</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.AdminUsers = AdminUsers;
