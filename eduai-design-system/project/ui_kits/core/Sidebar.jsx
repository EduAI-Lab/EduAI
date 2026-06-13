/* Sidebar.jsx — matches app-sidebar.tsx + nav-user.tsx exactly */

const _SB = {
  bg:     "oklch(0.192 0.055 259)",
  border: "oklch(0.248 0.048 259)",
  active: "oklch(0.248 0.055 259)",
  hover:  "oklch(0.218 0.050 259)",
  text:   "rgba(255,255,255,0.82)",
  muted:  "rgba(255,255,255,0.46)",
  gold:   "#FFD100",
};

const _SB_ICONS = {
  dashboard: ["M3 3h7v7H3z","M14 3h7v7h-7z","M3 14h7v7H3z","M14 14h7v7h-7z"],
  books:     ["M4 19V7.5a3.5 3.5 0 0 1 7 0V19","M11 7.5a3.5 3.5 0 0 1 7 0V19","M4 19h16"],
  brain:     ["M9.5 2a2.5 2.5 0 1 1 5 0","M4 9.5a2.5 2.5 0 1 1 5 0","M15 9.5a2.5 2.5 0 1 1 5 0","M12 4.5v5","M6.5 12l3.5-2.5","M17.5 12l-3.5-2.5","M6.5 12a5.5 5.5 0 0 0 11 0"],
  users:     ["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2","M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z","M23 21v-2a4 4 0 0 0-3-3.87","M16 3.13a4 4 0 0 1 0 7.75"],
  robot:     ["M12 8V4","M8 4h8","M7 8h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z","M9 13h.01","M15 13h.01"],
  camera:    ["M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z","M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  report:    ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z","M14 2v6h6","M16 13H8","M16 17H8","M10 9H8"],
  settings:  ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z","M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a2 2 0 0 1-4 0"],
  help:      ["M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z","M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3","M12 17h.01"],
  logout:    ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4","M16 17l5-5-5-5","M21 12H9"],
  dots:      ["M12 5h.01","M12 12h.01","M12 19h.01"],
  account:   ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2","M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  bell:      ["M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9","M13.73 21a2 2 0 0 1-3.46 0"],
};

const _ROLE_BADGES = {
  ADMIN:     { label: "Admin",   bg: "oklch(0.63 0.22 25)"  },
  PROFESSOR: { label: "Prof",    bg: "oklch(0.56 0.20 255)" },
  TA:        { label: "TA",      bg: "oklch(0.61 0.19 145)" },
  STUDENT:   { label: "Student", bg: "oklch(0.55 0 0)"      },
};

/* Nav structure matches app-sidebar.tsx exactly */
const _NAV_MAIN = [
  { id: "dashboard",   label: "Dashboard",      icon: "dashboard" },
  { id: "courses",     label: "Courses",         icon: "books"     },
  { id: "admin-ai",    label: "AI Management",   icon: "brain",    adminOnly: true },
  { id: "admin-users", label: "User Management", icon: "users",    adminOnly: true },
  { id: "chatbot",     label: "Chatbot",         icon: "robot"     },
  { id: "analytics",   label: "Analytics",       icon: "camera",   stub: true },
  { id: "reports",     label: "Reports",         icon: "report",   stub: true },
];

const _NAV_SEC = [
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "help",     label: "Get Help", icon: "help",    stub: true },
];

function SBIcon({ name, size = 16, color }) {
  const d = _SB_ICONS[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color || "currentColor"} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {(Array.isArray(d) ? d : [d]).map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

function Sidebar({ currentScreen, onNavigate, user }) {
  const [showMenu, setShowMenu] = React.useState(false);
  const [hov, setHov]           = React.useState(null);

  const role  = user?.role || "STUDENT";
  const badge = _ROLE_BADGES[role] || _ROLE_BADGES.STUDENT;
  const initials = (user?.name || "U").split(" ").map(p => p[0]).join("").slice(0,2).toUpperCase();

  /* map chatbot ↔ chat so the nav highlights correctly */
  const activeId = currentScreen === "chatbot" ? "chatbot"
                 : currentScreen === "chat"    ? "chatbot"
                 : currentScreen;

  const visible = _NAV_MAIN.filter(i => !i.adminOnly || role === "ADMIN");

  const Item = ({ item }) => {
    const on   = activeId === item.id;
    const hovd = hov === item.id;
    return (
      <button
        onClick={() => { if (!item.stub) onNavigate(item.id); }}
        onMouseEnter={() => setHov(item.id)}
        onMouseLeave={() => setHov(null)}
        style={{
          position: "relative", display: "flex", alignItems: "center", gap: "10px",
          width: "100%", padding: "9px 14px 9px 16px", borderRadius: "7px",
          background: on ? _SB.active : hovd && !item.stub ? _SB.hover : "transparent",
          border: "none", cursor: item.stub ? "default" : "pointer",
          color: item.stub ? _SB.muted : on ? "#fff" : _SB.text,
          fontFamily: "var(--font-sans)", fontSize: "13.5px", fontWeight: on ? 500 : 400,
          transition: "background 120ms",
        }}
      >
        {on && <div style={{ position:"absolute", left:0, top:"8px", bottom:"8px", width:"3px", borderRadius:"0 2px 2px 0", background: _SB.gold }} />}
        <SBIcon name={item.icon} size={16} />
        <span style={{ flex: 1 }}>{item.label}</span>
        {item.stub && <span style={{ fontSize:"10px", opacity:.5 }}>Soon</span>}
      </button>
    );
  };

  return (
    <aside style={{ width:"240px", minWidth:"240px", height:"100vh", background:_SB.bg, display:"flex", flexDirection:"column", borderRight:`1px solid ${_SB.border}` }}>

      {/* Logo */}
      <div style={{ height:"56px", display:"flex", alignItems:"center", padding:"0 16px", gap:"9px", borderBottom:`1px solid ${_SB.border}`, flexShrink:0 }}>
        <div style={{ width:"28px", height:"28px", borderRadius:"7px", background:"oklch(0.42 0.14 232)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.75" strokeLinecap="round">
            <circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18"/><path d="M3 12h18"/><path d="M12 3c2 2 3.5 5.5 3.5 9s-1.5 7-3.5 9"/>
          </svg>
        </div>
        <span style={{ fontSize:"15px", fontWeight:700, color:"#fff", letterSpacing:"-0.01em" }}>EduAI</span>
      </div>

      {/* Nav */}
      <div style={{ flex:1, padding:"10px 8px", display:"flex", flexDirection:"column", gap:"2px", overflowY:"auto" }}>
        {visible.map(i => <Item key={i.id} item={i} />)}
        <div style={{ flex:1 }} />
        <div style={{ height:"1px", background:_SB.border, margin:"6px 0" }} />
        {_NAV_SEC.map(i => <Item key={i.id} item={i} />)}
      </div>

      {/* User footer */}
      <div style={{ position:"relative", borderTop:`1px solid ${_SB.border}`, padding:"8px" }}>
        {showMenu && (
          <div style={{ position:"absolute", bottom:"calc(100% + 4px)", left:"8px", right:"8px", background:"oklch(0.240 0.048 259)", border:`1px solid ${_SB.border}`, borderRadius:"10px", overflow:"hidden", zIndex:100, boxShadow:"0 -8px 24px rgba(0,0,0,0.35)" }}>
            <div style={{ padding:"12px 14px", borderBottom:`1px solid ${_SB.border}` }}>
              <div style={{ fontSize:"13px", fontWeight:600, color:"#fff" }}>{user?.name}</div>
              <div style={{ fontSize:"11px", color:_SB.muted }}>{user?.email}</div>
            </div>
            {[{l:"Account",icon:"account"},{l:"Notifications",icon:"bell"}].map(m => (
              <button key={m.l} style={{ display:"flex", alignItems:"center", gap:"9px", width:"100%", padding:"9px 14px", background:"transparent", border:"none", color:_SB.text, fontFamily:"var(--font-sans)", fontSize:"13px", cursor:"pointer" }}
                onMouseEnter={e=>e.currentTarget.style.background=_SB.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <SBIcon name={m.icon} size={15}/>{m.l}
              </button>
            ))}
            <div style={{ height:"1px", background:_SB.border }} />
            <button onClick={() => { setShowMenu(false); onNavigate("logout"); }}
              style={{ display:"flex", alignItems:"center", gap:"9px", width:"100%", padding:"9px 14px", background:"transparent", border:"none", color:"oklch(0.72 0.19 25)", fontFamily:"var(--font-sans)", fontSize:"13px", cursor:"pointer" }}
              onMouseEnter={e=>e.currentTarget.style.background="oklch(0.72 0.19 25 / 0.12)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <SBIcon name="logout" size={15} color="oklch(0.72 0.19 25)" />Log out
            </button>
          </div>
        )}
        <button onClick={() => setShowMenu(v => !v)}
          style={{ display:"flex", alignItems:"center", gap:"10px", width:"100%", padding:"7px 10px", borderRadius:"8px", background:showMenu?_SB.active:"transparent", border:"none", cursor:"pointer", transition:"background 120ms" }}
          onMouseEnter={e=>{ if(!showMenu) e.currentTarget.style.background=_SB.hover; }}
          onMouseLeave={e=>{ if(!showMenu) e.currentTarget.style.background="transparent"; }}>
          <div style={{ width:"32px", height:"32px", borderRadius:"8px", flexShrink:0, background:"oklch(0.42 0.14 232)", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:700, fontSize:"12px" }}>
            {initials}
          </div>
          <div style={{ flex:1, textAlign:"left", minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:"5px" }}>
              <span style={{ fontSize:"13px", fontWeight:500, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user?.name || "User"}</span>
              <span style={{ fontSize:"10px", fontWeight:700, padding:"1px 5px", borderRadius:"999px", background:badge.bg, color:"#fff", flexShrink:0 }}>{badge.label}</span>
            </div>
            <div style={{ fontSize:"11px", color:_SB.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user?.email}</div>
          </div>
          <SBIcon name="dots" size={14} color={_SB.muted} />
        </button>
      </div>
    </aside>
  );
}

window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.Sidebar = Sidebar;
