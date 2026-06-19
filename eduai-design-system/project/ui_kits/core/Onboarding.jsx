/* Onboarding.jsx — student ID linking flow (/onboarding/student-id) */

function Onboarding({ user, onComplete }) {
  const [step, setStep] = React.useState("link"); // "link" | "success"
  const [studentId, setStudentId] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!studentId.match(/^\d{8}$/)) {
      setError("Please enter a valid 8-digit UBC student number.");
      return;
    }
    setError("");
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setStep("success");
    }, 1100);
  };

  const handleSkip = () => onComplete();

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--color-blue-50)", fontFamily: "var(--font-sans)", position: "relative",
    }}>
      {/* Gold top bar */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: "3px", background: "var(--gold)" }} />

      {/* Logo row */}
      <div style={{ position: "fixed", top: "16px", left: "24px", display: "flex", alignItems: "center", gap: "8px" }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <path d="M12 3a9 9 0 0 1 0 18"/><path d="M3 12h18"/>
          <path d="M12 3c2 2 3.5 5.5 3.5 9s-1.5 7-3.5 9"/>
        </svg>
        <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--primary)" }}>EduAI</span>
      </div>

      {step === "link" ? (
        <div style={{
          width: "100%", maxWidth: "460px", margin: "0 16px",
          background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)", padding: "40px 36px",
          boxShadow: "var(--shadow-lg)",
        }}>
          {/* Step indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "28px" }}>
            {[1, 2].map(n => (
              <React.Fragment key={n}>
                <div style={{
                  width: "24px", height: "24px", borderRadius: "50%", flexShrink: 0,
                  background: n === 1 ? "var(--primary)" : "var(--muted)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "11px", fontWeight: 700,
                  color: n === 1 ? "#fff" : "var(--muted-foreground)",
                }}>{n}</div>
                {n < 2 && <div style={{ flex: 1, height: "2px", background: "var(--border)" }} />}
              </React.Fragment>
            ))}
          </div>

          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--foreground)", margin: "0 0 8px" }}>
            Link your UBC student number
          </h1>
          <p style={{ fontSize: "14px", color: "var(--muted-foreground)", margin: "0 0 24px", lineHeight: 1.6 }}>
            We use your student number to match your account with Canvas enrolment data. This lets us sync the courses you're registered in.
          </p>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              <label style={{ fontSize: "13px", fontWeight: 500, color: "var(--foreground)" }}>UBC Student Number</label>
              <input
                type="text" inputMode="numeric" value={studentId}
                onChange={e => setStudentId(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="e.g. 12345678"
                disabled={loading}
                style={{
                  padding: "9px 12px", fontSize: "18px", fontFamily: "var(--font-mono)",
                  border: `1px solid ${error ? "var(--destructive)" : "var(--border)"}`,
                  borderRadius: "var(--radius-md)", background: "var(--input)",
                  color: "var(--foreground)", outline: "none", letterSpacing: "0.1em",
                }}
              />
              {error && <span style={{ fontSize: "12px", color: "var(--destructive)" }}>{error}</span>}
              <span style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>
                Your 8-digit student number, found on your UBC Card or SSC.
              </span>
            </div>

            <div style={{ padding: "12px 14px", background: "var(--color-blue-50)", borderRadius: "var(--radius-base)", border: "1px solid var(--color-blue-100)", display: "flex", gap: "10px" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: "1px" }}>
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
              </svg>
              <span style={{ fontSize: "12px", color: "var(--secondary)", lineHeight: 1.5 }}>
                Your student number is only used to match Canvas enrolments. It's stored securely and never shared.
              </span>
            </div>

            <button type="submit" disabled={loading || studentId.length !== 8} style={{
              padding: "10px", fontSize: "14px", fontWeight: 500,
              background: (loading || studentId.length !== 8) ? "var(--muted)" : "var(--primary)",
              color: (loading || studentId.length !== 8) ? "var(--muted-foreground)" : "var(--primary-foreground)",
              border: "none", borderRadius: "var(--radius-base)",
              cursor: (loading || studentId.length !== 8) ? "not-allowed" : "pointer",
              fontFamily: "var(--font-sans)", minHeight: "44px", transition: "background 150ms",
            }}>
              {loading ? "Verifying…" : "Link student number"}
            </button>

            <button type="button" onClick={handleSkip} style={{
              padding: "8px", fontSize: "13px", color: "var(--muted-foreground)",
              background: "transparent", border: "none", cursor: "pointer",
              fontFamily: "var(--font-sans)", textDecoration: "underline", textUnderlineOffset: "3px",
            }}>
              Skip for now — I'll do this later
            </button>
          </form>
        </div>
      ) : (
        /* Success state */
        <div style={{
          width: "100%", maxWidth: "420px", margin: "0 16px",
          background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)", padding: "48px 36px",
          boxShadow: "var(--shadow-lg)", textAlign: "center",
        }}>
          <div style={{
            width: "64px", height: "64px", borderRadius: "50%", margin: "0 auto 20px",
            background: "var(--color-success-100)", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--color-success-600)" strokeWidth="2.5" strokeLinecap="round">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          </div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--foreground)", margin: "0 0 8px" }}>All set!</h1>
          <p style={{ fontSize: "14px", color: "var(--muted-foreground)", margin: "0 0 28px", lineHeight: 1.6 }}>
            Student number <strong style={{ color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{studentId}</strong> linked successfully. Your Canvas courses will sync automatically.
          </p>
          <button onClick={onComplete} style={{
            width: "100%", padding: "10px", fontSize: "14px", fontWeight: 500,
            background: "var(--primary)", color: "var(--primary-foreground)",
            border: "none", borderRadius: "var(--radius-base)", cursor: "pointer",
            fontFamily: "var(--font-sans)", minHeight: "44px",
          }}>
            Go to Dashboard
          </button>
        </div>
      )}
    </div>
  );
}

window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.Onboarding = Onboarding;
