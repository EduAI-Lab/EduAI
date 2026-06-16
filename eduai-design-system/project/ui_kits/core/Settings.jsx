/* Settings.jsx — tabbed settings page: API Keys · Canvas */

const SETTINGS_TABS = ["API Keys", "Canvas"];

const API_KEYS = [
  { name: "Bench testing key", prefix: "ba_live_••••••••••••", created: "May 12, 2025", lastUsed: "Jun 10, 2025" },
  { name: "CI pipeline key",   prefix: "ba_live_••••••••••••", created: "Apr 3, 2025",  lastUsed: "Jun 11, 2025" },
];

function SettingsSiteHeader() {
  return (
    <div style={{
      height: "56px", borderBottom: "1px solid var(--border)", flexShrink: 0,
      display: "flex", alignItems: "center", padding: "0 24px",
      background: "var(--background)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--muted-foreground)" }}>
        <span>Home</span>
        <span style={{ color: "var(--border)" }}>/</span>
        <span style={{ color: "var(--foreground)", fontWeight: 500 }}>Settings</span>
      </div>
    </div>
  );
}

function SettingsTabBar({ active, onSelect }) {
  return (
    <div style={{
      display: "flex", borderBottom: "1px solid var(--border)",
      padding: "0 24px", background: "var(--background)", flexShrink: 0,
    }}>
      {SETTINGS_TABS.map(tab => (
        <button key={tab} onClick={() => onSelect(tab)} style={{
          padding: "12px 16px", fontSize: "14px",
          fontWeight: active === tab ? 500 : 400,
          color: active === tab ? "var(--foreground)" : "var(--muted-foreground)",
          background: "none", border: "none", cursor: "pointer",
          borderBottom: active === tab ? "2px solid var(--primary)" : "2px solid transparent",
          marginBottom: "-1px", fontFamily: "var(--font-sans)", transition: "color 120ms",
        }}>{tab}</button>
      ))}
    </div>
  );
}

function ApiKeysTab() {
  const [showCreate, setShowCreate] = React.useState(false);
  const [keyName, setKeyName] = React.useState("");
  const [copied, setCopied] = React.useState(null);

  const handleCopy = (i) => { setCopied(i); setTimeout(() => setCopied(null), 1800); };

  return (
    <div style={{ padding: "28px 24px", maxWidth: "720px", display: "flex", flexDirection: "column", gap: "24px" }}>
      <div>
        <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--foreground)", margin: "0 0 6px" }}>API Keys</h2>
        <p style={{ fontSize: "14px", color: "var(--muted-foreground)", margin: 0, lineHeight: 1.5 }}>
          Create API keys for programmatic access to EduAI. Keys are shown once on creation — store them securely.
        </p>
      </div>

      {/* Create key */}
      <div style={{
        background: "var(--card)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)", overflow: "hidden",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--foreground)" }}>Create new key</span>
          <button
            onClick={() => setShowCreate(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "6px 13px", fontSize: "13px", fontWeight: 500,
              background: showCreate ? "var(--muted)" : "var(--primary)",
              color: showCreate ? "var(--foreground)" : "var(--primary-foreground)",
              border: "none", borderRadius: "var(--radius-base)", cursor: "pointer", fontFamily: "var(--font-sans)",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            {showCreate ? "Cancel" : "New key"}
          </button>
        </div>
        {showCreate && (
          <div style={{ padding: "16px 20px", display: "flex", gap: "10px" }}>
            <input
              value={keyName} onChange={e => setKeyName(e.target.value)}
              placeholder="Key name (e.g. Bench testing)"
              style={{
                flex: 1, padding: "8px 12px", fontSize: "13px", fontFamily: "var(--font-sans)",
                border: "1px solid var(--border)", borderRadius: "var(--radius-base)",
                background: "var(--input)", color: "var(--foreground)", outline: "none",
              }}
            />
            <button style={{
              padding: "8px 16px", fontSize: "13px", fontWeight: 500,
              background: "var(--primary)", color: "var(--primary-foreground)",
              border: "none", borderRadius: "var(--radius-base)", cursor: "pointer", fontFamily: "var(--font-sans)",
            }}>Create</button>
          </div>
        )}
      </div>

      {/* Key list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
        {API_KEYS.map((k, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: "14px",
            padding: "14px 18px", background: "var(--card)",
            borderTop: i === 0 ? "1px solid var(--border)" : "none",
            borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
            borderRadius: i === 0 ? "var(--radius-lg) var(--radius-lg) 0 0" : i === API_KEYS.length - 1 ? "0 0 var(--radius-lg) var(--radius-lg)" : "0",
          }}>
            <div style={{
              width: "36px", height: "36px", borderRadius: "8px", flexShrink: 0,
              background: "var(--color-blue-50)", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.75" strokeLinecap="round">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--foreground)" }}>{k.name}</div>
              <div style={{ fontSize: "12px", color: "var(--muted-foreground)", marginTop: "2px", fontFamily: "var(--font-mono)" }}>{k.prefix}</div>
            </div>
            <div style={{ fontSize: "12px", color: "var(--muted-foreground)", textAlign: "right" }}>
              <div>Created {k.created}</div>
              <div>Last used {k.lastUsed}</div>
            </div>
            <button onClick={() => handleCopy(i)} style={{
              display: "flex", alignItems: "center", gap: "5px",
              padding: "6px 12px", fontSize: "12px", fontWeight: 500,
              background: copied === i ? "var(--color-success-100)" : "var(--muted)",
              color: copied === i ? "var(--color-success-700)" : "var(--foreground)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
              cursor: "pointer", fontFamily: "var(--font-sans)", transition: "background 200ms",
            }}>
              {copied === i ? "✓ Copied" : "Copy"}
            </button>
            <button style={{
              padding: "6px 12px", fontSize: "12px", fontWeight: 500,
              background: "transparent", color: "var(--destructive)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
              cursor: "pointer", fontFamily: "var(--font-sans)",
            }}>Revoke</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CanvasTab() {
  const [connected, setConnected] = React.useState(false);
  const [url, setUrl] = React.useState("https://canvas.ubc.ca");
  const [token, setToken] = React.useState("");

  return (
    <div style={{ padding: "28px 24px", maxWidth: "720px", display: "flex", flexDirection: "column", gap: "24px" }}>
      <div>
        <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--foreground)", margin: "0 0 6px" }}>Canvas Integration</h2>
        <p style={{ fontSize: "14px", color: "var(--muted-foreground)", margin: 0, lineHeight: 1.5 }}>
          Connect your Canvas LMS account to sync course rosters, assignments, and student enrollments.
        </p>
      </div>

      {/* Connection status */}
      <div style={{
        background: connected ? "var(--color-success-100)" : "var(--muted)",
        border: `1px solid ${connected ? "var(--color-success-200)" : "var(--border)"}`,
        borderRadius: "var(--radius-lg)", padding: "16px 20px",
        display: "flex", alignItems: "center", gap: "12px",
      }}>
        <div style={{
          width: "36px", height: "36px", borderRadius: "8px", flexShrink: 0,
          background: connected ? "var(--color-success-500)" : "var(--muted-foreground)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            {connected
              ? <path d="M20 6L9 17l-5-5"/>
              : <><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></>
            }
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: connected ? "var(--color-success-700)" : "var(--foreground)" }}>
            {connected ? "Canvas connected" : "Canvas not connected"}
          </div>
          <div style={{ fontSize: "12px", color: connected ? "var(--color-success-600)" : "var(--muted-foreground)", marginTop: "2px" }}>
            {connected ? `Connected to ${url}` : "Add your Canvas API key to enable sync"}
          </div>
        </div>
        {connected && (
          <button onClick={() => setConnected(false)} style={{
            padding: "6px 13px", fontSize: "13px", fontWeight: 500,
            background: "transparent", color: "var(--destructive)",
            border: "1px solid var(--border)", borderRadius: "var(--radius-base)",
            cursor: "pointer", fontFamily: "var(--font-sans)",
          }}>Disconnect</button>
        )}
      </div>

      {/* Config form */}
      {!connected && (
        <div style={{
          background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)", padding: "20px 24px",
          display: "flex", flexDirection: "column", gap: "16px",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <label style={{ fontSize: "13px", fontWeight: 500, color: "var(--foreground)" }}>Canvas URL</label>
            <input
              value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://canvas.institution.edu"
              style={{
                padding: "8px 12px", fontSize: "13px", fontFamily: "var(--font-sans)",
                border: "1px solid var(--border)", borderRadius: "var(--radius-base)",
                background: "var(--input)", color: "var(--foreground)", outline: "none",
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <label style={{ fontSize: "13px", fontWeight: 500, color: "var(--foreground)" }}>API Token</label>
            <input
              type="password" value={token} onChange={e => setToken(e.target.value)}
              placeholder="Paste your Canvas API token…"
              style={{
                padding: "8px 12px", fontSize: "13px", fontFamily: "var(--font-sans)",
                border: "1px solid var(--border)", borderRadius: "var(--radius-base)",
                background: "var(--input)", color: "var(--foreground)", outline: "none",
              }}
            />
            <span style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>
              Generate from Canvas → Account → Settings → New Access Token
            </span>
          </div>
          <button onClick={() => token && setConnected(true)} style={{
            alignSelf: "flex-start", padding: "8px 18px", fontSize: "13px", fontWeight: 500,
            background: token ? "var(--primary)" : "var(--muted)",
            color: token ? "var(--primary-foreground)" : "var(--muted-foreground)",
            border: "none", borderRadius: "var(--radius-base)", cursor: token ? "pointer" : "not-allowed",
            fontFamily: "var(--font-sans)", transition: "background 150ms",
          }}>Connect Canvas</button>
        </div>
      )}
    </div>
  );
}

function Settings() {
  const [tab, setTab] = React.useState("API Keys");
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "var(--font-sans)", background: "var(--background)" }}>
      <SettingsSiteHeader />
      <SettingsTabBar active={tab} onSelect={setTab} />
      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "API Keys" && <ApiKeysTab />}
        {tab === "Canvas"   && <CanvasTab />}
      </div>
    </div>
  );
}

window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.Settings = Settings;
