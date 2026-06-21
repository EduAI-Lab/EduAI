/* Auth.jsx — login + register with role demo selector */

const DEMO_USERS = [
  { name: "Alex Chen",        email: "alex.chen@student.ubc.ca",  role: "STUDENT",   password: "demo" },
  { name: "Dr. Sarah Chen",   email: "s.chen@ubc.ca",             role: "PROFESSOR",  password: "demo" },
  { name: "Tom Walker",       email: "t.walker@ta.ubc.ca",        role: "TA",         password: "demo" },
  { name: "Dr. Sandra Hobbes",email: "s.hobbes@ubc.ca",           role: "ADMIN",      password: "demo" },
];

function Auth({ onLogin }) {
  const [mode, setMode]         = React.useState("login"); // "login" | "register"
  const [email, setEmail]       = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName]         = React.useState("");
  const [error, setError]       = React.useState("");
  const [loading, setLoading]   = React.useState(false);

  const handleLogin = (e) => {
    if (e) e.preventDefault();
    setError("");
    if (!email || !password) { setError("Please enter your email and password."); return; }
    setLoading(true);
    setTimeout(() => {
      const match = DEMO_USERS.find(u => u.email === email);
      if (match) {
        onLogin(match);
      } else {
        onLogin({ name: email.split("@")[0], email, role: "STUDENT" });
      }
      setLoading(false);
    }, 700);
  };

  const handleDemoLogin = (u) => {
    setLoading(true);
    setTimeout(() => { onLogin(u); setLoading(false); }, 400);
  };

  const inputStyle = {
    width: "100%", padding: "9px 12px", fontSize: "14px", fontFamily: "var(--font-sans)",
    border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
    background: "var(--background)", color: "var(--foreground)", outline: "none",
    boxSizing: "border-box", transition: "border-color 150ms",
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"oklch(0.972 0.006 258)", fontFamily:"var(--font-sans)", position:"relative" }}>
      {/* Gold top bar */}
      <div style={{ position:"fixed", top:0, left:0, right:0, height:"3px", background:"#FFD100", zIndex:10 }} />

      {/* Logo */}
      <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"28px" }}>
        <div style={{ width:"36px", height:"36px", borderRadius:"9px", background:"oklch(0.192 0.055 259)", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.75" strokeLinecap="round">
            <circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18"/><path d="M3 12h18"/><path d="M12 3c2 2 3.5 5.5 3.5 9s-1.5 7-3.5 9"/>
          </svg>
        </div>
        <span style={{ fontSize:"20px", fontWeight:700, color:"oklch(0.192 0.055 259)", letterSpacing:"-0.01em" }}>EduAI</span>
      </div>

      {/* Card */}
      <div style={{ width:"100%", maxWidth:"440px", margin:"0 16px", background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-xl)", padding:"36px 32px", boxShadow:"0 4px 24px rgba(0,0,0,0.08)" }}>

        {/* Mode toggle */}
        <div style={{ display:"flex", background:"var(--muted)", borderRadius:"var(--radius-lg)", padding:"3px", marginBottom:"24px" }}>
          {[["login","Sign in"],["register","Register"]].map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex:1, padding:"7px", fontSize:"13.5px", fontWeight: mode===m ? 600 : 400,
              background: mode===m ? "#fff" : "transparent",
              color: mode===m ? "var(--foreground)" : "var(--muted-foreground)",
              border:"none", borderRadius:"var(--radius-md)", cursor:"pointer",
              fontFamily:"var(--font-sans)", boxShadow: mode===m ? "0 1px 4px rgba(0,0,0,0.10)" : "none",
              transition:"all 150ms",
            }}>{label}</button>
          ))}
        </div>

        <h1 style={{ fontSize:"20px", fontWeight:700, color:"var(--foreground)", margin:"0 0 4px" }}>
          {mode === "login" ? "Welcome back" : "Create your account"}
        </h1>
        <p style={{ fontSize:"13px", color:"var(--muted-foreground)", margin:"0 0 22px" }}>
          {mode === "login" ? "Sign in to your UBC EduAI account." : "Get started with AI-powered learning."}
        </p>

        <form onSubmit={handleLogin} style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
          {mode === "register" && (
            <div style={{ display:"flex", flexDirection:"column", gap:"5px" }}>
              <label style={{ fontSize:"13px", fontWeight:500, color:"var(--foreground)" }}>Full name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Dr. Jane Smith" style={inputStyle} />
            </div>
          )}
          <div style={{ display:"flex", flexDirection:"column", gap:"5px" }}>
            <label style={{ fontSize:"13px", fontWeight:500, color:"var(--foreground)" }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@ubc.ca" style={inputStyle} />
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:"5px" }}>
            <label style={{ fontSize:"13px", fontWeight:500, color:"var(--foreground)" }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={inputStyle} />
          </div>

          {error && <p style={{ fontSize:"12px", color:"var(--destructive)", margin:0 }}>{error}</p>}

          <button type="submit" disabled={loading} style={{
            padding:"10px", fontSize:"14px", fontWeight:600,
            background: loading ? "var(--muted)" : "oklch(0.192 0.055 259)",
            color: loading ? "var(--muted-foreground)" : "#fff",
            border:"none", borderRadius:"var(--radius-lg)", cursor: loading ? "not-allowed" : "pointer",
            fontFamily:"var(--font-sans)", minHeight:"44px", transition:"background 150ms",
          }}>{loading ? "Signing in…" : mode === "login" ? "Sign in" : "Create account"}</button>
        </form>

        {/* Demo quick-login */}
        <div style={{ marginTop:"24px", paddingTop:"20px", borderTop:"1px solid var(--border)" }}>
          <p style={{ fontSize:"11px", fontWeight:600, color:"var(--muted-foreground)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:"10px" }}>Demo accounts</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"7px" }}>
            {DEMO_USERS.map(u => (
              <button key={u.role} onClick={() => handleDemoLogin(u)} disabled={loading} style={{
                padding:"8px 10px", fontSize:"12px", fontWeight:500, textAlign:"left",
                background:"var(--muted)", color:"var(--foreground)",
                border:"1px solid var(--border)", borderRadius:"var(--radius-md)",
                cursor:"pointer", fontFamily:"var(--font-sans)", transition:"border-color 150ms",
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor="oklch(0.192 0.055 259)"}
              onMouseLeave={e => e.currentTarget.style.borderColor="var(--border)"}>
                <div style={{ fontWeight:600 }}>{u.role === "PROFESSOR" ? "Prof." : u.role.charAt(0) + u.role.slice(1).toLowerCase()}</div>
                <div style={{ fontSize:"10px", color:"var(--muted-foreground)", marginTop:"1px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{u.name}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <p style={{ marginTop:"20px", fontSize:"12px", color:"var(--muted-foreground)" }}>
        University of British Columbia · EduAI Platform
      </p>
    </div>
  );
}

window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.Auth = Auth;
