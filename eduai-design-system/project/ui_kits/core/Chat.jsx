/* Chat.jsx — matches chat.tsx: model+course selectors in bottom bar, system prompt above */

const _CHAT_COURSES = [
  { code: "CPSC 110", name: "Computation, Programs, and Programming" },
  { code: "MATH 200", name: "Calculus III" },
  { code: "PHYS 101", name: "Energy and Waves" },
];

const _CHAT_MODELS = [
  { id: "openai:gpt-4o",       name: "GPT-4o",        provider: "OpenAI"    },
  { id: "openai:gpt-4o-mini",  name: "GPT-4o mini",   provider: "OpenAI"    },
  { id: "anthropic:claude-3-5-sonnet", name: "Claude 3.5 Sonnet", provider: "Anthropic" },
];

const _PROMPTS = [
  { text: "Explain tail recursion with an example", course: "CPSC 110" },
  { text: "What's the difference between partial and total derivatives?", course: "MATH 200" },
  { text: "How does the HtDF design recipe work?", course: "CPSC 110" },
  { text: "Summarise this week's lecture on energy", course: "PHYS 101" },
];

const _AI_RESPONSES = {
  default: "Great question! Based on the course materials, I can help explain that concept. In functional programming, this is a fundamental idea that builds on the design recipes we've been using throughout the course. Let me walk you through it step by step.\n\nFirst, let's consider what happens when a function calls itself — this is the essence of recursion. Tail recursion specifically refers to a recursive call that is the *last* operation the function performs before returning. This allows the compiler or interpreter to optimize the call by reusing the current stack frame.",
  "What's the difference between partial and total derivatives?": "Excellent question for MATH 200! Let's break this down clearly.\n\nA **partial derivative** treats all variables except one as constants and differentiates with respect to that single variable. If f(x, y) = x² + xy, then ∂f/∂x = 2x + y.\n\nA **total derivative** accounts for how *all* variables change simultaneously. It combines all partial derivatives weighted by how each variable changes.\n\nThe key distinction: partial derivatives are used when you want to measure sensitivity in one direction at a time, while total derivatives capture the full rate of change.",
};

function Chat({ user }) {
  const [messages, setMessages]       = React.useState([]);
  const [input, setInput]             = React.useState("");
  const [loading, setLoading]         = React.useState(false);
  const [course, setCourse]           = React.useState(null);
  const [model, setModel]             = React.useState(_CHAT_MODELS[0].id);
  const [showSysPrompt, setShowSysPrompt] = React.useState(false);
  const [showCourseDD, setShowCourseDD]   = React.useState(false);
  const [showModelDD, setShowModelDD]     = React.useState(false);
  const scrollRef = React.useRef(null);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const send = (text) => {
    const q = text || input.trim();
    if (!q || loading) return;
    setInput("");
    setMessages(m => [...m, { role:"user", content:q }]);
    setLoading(true);
    setTimeout(() => {
      const reply = _AI_RESPONSES[q] || _AI_RESPONSES.default;
      setMessages(m => [...m, { role:"assistant", content:reply }]);
      setLoading(false);
    }, 1200);
  };

  const selectedModel = _CHAT_MODELS.find(m => m.id === model) || _CHAT_MODELS[0];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", fontFamily:"var(--font-sans)", background:"oklch(0.984 0.003 258)" }}>

      {/* Site header */}
      <div style={{ height:"56px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", padding:"0 28px", justifyContent:"space-between", flexShrink:0, background:"var(--background)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"6px", fontSize:"13px", color:"var(--muted-foreground)" }}>
          <span>Home</span><span style={{ color:"var(--border)" }}>/</span>
          <span style={{ color:"var(--foreground)", fontWeight:500 }}>Chatbot</span>
          {course && <><span style={{ color:"var(--border)" }}>·</span><span style={{ color:"oklch(0.192 0.055 259)", fontWeight:500 }}>{course}</span></>}
        </div>
        {/* System prompt button */}
        <button onClick={() => setShowSysPrompt(v=>!v)} style={{ display:"flex", alignItems:"center", gap:"5px", padding:"5px 11px", fontSize:"12px", fontWeight:500, background: showSysPrompt ? "oklch(0.192 0.055 259)" : "var(--muted)", color: showSysPrompt ? "#fff" : "var(--muted-foreground)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", cursor:"pointer", fontFamily:"var(--font-sans)", transition:"all 150ms" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4"/></svg>
          System Prompt
        </button>
      </div>

      {/* System prompt panel */}
      {showSysPrompt && (
        <div style={{ borderBottom:"1px solid var(--border)", padding:"14px 28px", background:"var(--card)", flexShrink:0 }}>
          <label style={{ fontSize:"12px", fontWeight:600, color:"var(--muted-foreground)", display:"block", marginBottom:"6px" }}>Custom System Prompt (optional)</label>
          <textarea placeholder="Override the default AI system prompt for this session…" rows={2} style={{ width:"100%", padding:"8px 12px", fontSize:"13px", fontFamily:"var(--font-sans)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", background:"var(--background)", color:"var(--foreground)", outline:"none", resize:"none", boxSizing:"border-box" }} />
        </div>
      )}

      {/* Messages area */}
      <div ref={scrollRef} style={{ flex:1, overflowY:"auto", padding:"24px 0" }}>
        <div style={{ maxWidth:"720px", margin:"0 auto", padding:"0 24px" }}>

          {messages.length === 0 ? (
            /* Welcome screen */
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"360px", textAlign:"center" }}>
              <div style={{ width:"64px", height:"64px", borderRadius:"16px", background:"oklch(0.192 0.055 259)", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:"18px" }}>
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M12 8V4M8 4h8M7 8h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"/><path d="M9 13h.01M15 13h.01"/>
                </svg>
              </div>
              <h2 style={{ fontSize:"20px", fontWeight:700, color:"var(--foreground)", margin:"0 0 6px" }}>
                {course ? `Chatting about ${course}` : "What would you like to know?"}
              </h2>
              <p style={{ fontSize:"14px", color:"var(--muted-foreground)", margin:"0 0 24px", maxWidth:"380px", lineHeight:1.6 }}>
                {course
                  ? `Ask anything about your ${course} course materials — lectures, assignments, concepts.`
                  : "Select a course below to ground your questions in specific materials, or ask anything."}
              </p>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px", width:"100%", maxWidth:"520px" }}>
                {_PROMPTS.map((p,i) => (
                  <button key={i} onClick={() => send(p.text)}
                    style={{ padding:"12px 14px", fontSize:"13px", textAlign:"left", background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-xl)", cursor:"pointer", fontFamily:"var(--font-sans)", color:"var(--foreground)", lineHeight:1.4, transition:"border-color 150ms, box-shadow 150ms" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor="oklch(0.192 0.055 259)"; e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,0.08)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.boxShadow="none"; }}>
                    <div style={{ fontSize:"10px", fontWeight:700, color:"oklch(0.47 0.17 258)", marginBottom:"4px" }}>{p.course}</div>
                    {p.text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:"18px" }}>
              {messages.map((m, i) => (
                <div key={i} style={{ display:"flex", justifyContent: m.role==="user" ? "flex-end" : "flex-start" }}>
                  {m.role === "assistant" && (
                    <div style={{ width:"28px", height:"28px", borderRadius:"7px", background:"oklch(0.192 0.055 259)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginRight:"10px", marginTop:"2px" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.75" strokeLinecap="round">
                        <path d="M12 8V4M8 4h8M7 8h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"/><path d="M9 13h.01M15 13h.01"/>
                      </svg>
                    </div>
                  )}
                  <div style={{
                    maxWidth:"80%", padding:"12px 16px", borderRadius: m.role==="user" ? "16px 16px 4px 16px" : "4px 16px 16px 16px",
                    background: m.role==="user" ? "oklch(0.192 0.055 259)" : "var(--card)",
                    color: m.role==="user" ? "#fff" : "var(--foreground)",
                    border: m.role==="user" ? "none" : "1px solid var(--border)",
                    fontSize:"14px", lineHeight:1.6, whiteSpace:"pre-wrap",
                    boxShadow: m.role==="user" ? "none" : "0 1px 3px rgba(0,0,0,0.06)",
                  }}>{m.content}</div>
                </div>
              ))}
              {loading && (
                <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                  <div style={{ width:"28px", height:"28px", borderRadius:"7px", background:"oklch(0.192 0.055 259)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.75" strokeLinecap="round"><path d="M12 8V4M8 4h8M7 8h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"/><path d="M9 13h.01M15 13h.01"/></svg>
                  </div>
                  <div style={{ padding:"12px 16px", background:"var(--card)", border:"1px solid var(--border)", borderRadius:"4px 16px 16px 16px", display:"flex", gap:"5px", alignItems:"center" }}>
                    {[0,1,2].map(i => (
                      <div key={i} style={{ width:"6px", height:"6px", borderRadius:"50%", background:"var(--muted-foreground)", animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom input bar — matches ChatInput with integrated selectors */}
      <div style={{ borderTop:"1px solid var(--border)", background:"var(--background)", flexShrink:0 }}>
        <div style={{ maxWidth:"720px", margin:"0 auto", padding:"12px 24px 16px" }}>

          {/* Selector pills row */}
          <div style={{ display:"flex", gap:"8px", marginBottom:"10px" }}>
            {/* Course selector */}
            <div style={{ position:"relative" }}>
              <button onClick={() => { setShowCourseDD(v=>!v); setShowModelDD(false); }}
                style={{ display:"flex", alignItems:"center", gap:"5px", padding:"5px 11px", fontSize:"12px", fontWeight:500, background: course ? "oklch(0.192 0.055 259)" : "var(--muted)", color: course ? "#fff" : "var(--muted-foreground)", border:"1px solid var(--border)", borderRadius:"999px", cursor:"pointer", fontFamily:"var(--font-sans)", transition:"all 150ms" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 19V7.5a3.5 3.5 0 0 1 7 0V19M11 7.5a3.5 3.5 0 0 1 7 0V19M4 19h16"/></svg>
                {course || "Select course"}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              {showCourseDD && (
                <div style={{ position:"absolute", bottom:"calc(100% + 6px)", left:0, background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", overflow:"hidden", zIndex:50, minWidth:"220px", boxShadow:"0 4px 16px rgba(0,0,0,0.12)" }}>
                  <button onClick={() => { setCourse(null); setShowCourseDD(false); }}
                    style={{ width:"100%", padding:"9px 14px", fontSize:"13px", textAlign:"left", background: !course?"oklch(0.192 0.055 259 / 0.07)":"transparent", color:"var(--muted-foreground)", border:"none", cursor:"pointer", fontFamily:"var(--font-sans)" }}>
                    No course (general)
                  </button>
                  {_CHAT_COURSES.map(c => (
                    <button key={c.code} onClick={() => { setCourse(c.code); setShowCourseDD(false); }}
                      style={{ width:"100%", padding:"9px 14px", fontSize:"13px", textAlign:"left", background: course===c.code?"oklch(0.192 0.055 259 / 0.07)":"transparent", color:"var(--foreground)", border:"none", borderTop:"1px solid var(--border)", cursor:"pointer", fontFamily:"var(--font-sans)" }}>
                      <span style={{ fontWeight:600 }}>{c.code}</span> — {c.name.slice(0,28)}…
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Model selector */}
            <div style={{ position:"relative" }}>
              <button onClick={() => { setShowModelDD(v=>!v); setShowCourseDD(false); }}
                style={{ display:"flex", alignItems:"center", gap:"5px", padding:"5px 11px", fontSize:"12px", fontWeight:500, background:"var(--muted)", color:"var(--muted-foreground)", border:"1px solid var(--border)", borderRadius:"999px", cursor:"pointer", fontFamily:"var(--font-sans)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 8V4M8 4h8M7 8h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"/><path d="M9 13h.01M15 13h.01"/></svg>
                {selectedModel.name}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              {showModelDD && (
                <div style={{ position:"absolute", bottom:"calc(100% + 6px)", left:0, background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", overflow:"hidden", zIndex:50, minWidth:"200px", boxShadow:"0 4px 16px rgba(0,0,0,0.12)" }}>
                  {_CHAT_MODELS.map(m => (
                    <button key={m.id} onClick={() => { setModel(m.id); setShowModelDD(false); }}
                      style={{ width:"100%", padding:"9px 14px", fontSize:"13px", textAlign:"left", background: model===m.id?"oklch(0.192 0.055 259 / 0.07)":"transparent", color:"var(--foreground)", border:"none", borderTop: m !== _CHAT_MODELS[0] ? "1px solid var(--border)" : "none", cursor:"pointer", fontFamily:"var(--font-sans)" }}>
                      <span style={{ fontWeight:600 }}>{m.name}</span>
                      <span style={{ fontSize:"11px", color:"var(--muted-foreground)", marginLeft:"5px" }}>{m.provider}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Text input + send */}
          <div style={{ display:"flex", gap:"10px", alignItems:"flex-end" }}>
            <textarea
              value={input} onChange={e => setInput(e.target.value)} rows={1}
              onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={course ? `Ask about ${course} materials…` : "Ask anything…"}
              style={{ flex:1, padding:"10px 14px", fontSize:"14px", fontFamily:"var(--font-sans)", border:"1px solid var(--border)", borderRadius:"var(--radius-xl)", background:"var(--background)", color:"var(--foreground)", outline:"none", resize:"none", lineHeight:1.5, maxHeight:"120px", minHeight:"44px" }}
              onInput={e => { e.target.style.height="auto"; e.target.style.height=Math.min(e.target.scrollHeight,120)+"px"; }}
            />
            <button onClick={() => send()} disabled={!input.trim() || loading}
              style={{ width:"44px", height:"44px", borderRadius:"var(--radius-xl)", flexShrink:0, background: input.trim() && !loading ? "oklch(0.192 0.055 259)" : "var(--muted)", color: input.trim() && !loading ? "#fff" : "var(--muted-foreground)", border:"none", cursor: input.trim() && !loading ? "pointer" : "not-allowed", display:"flex", alignItems:"center", justifyContent:"center", transition:"background 150ms" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>
            </button>
          </div>
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,80%,100%{opacity:.3} 40%{opacity:1} }`}</style>
    </div>
  );
}

window.EduAIKit = window.EduAIKit || {};
window.EduAIKit.Chat = Chat;
