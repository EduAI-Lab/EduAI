"""Generate annotation PDFs for the remaining 6 IURA literature-review papers.

Pattern follows the existing SocraticLM annotation
(/Users/ahabmasudsiddiqui/Desktop/IURA/Literature_Review/Annotations/
 generate_socraticlm_annotation.py).

Each PDF contains:
  1. Seven-Item Annotation Template
     (Claim / Mechanism / Target outcome / Student / Metrics
      / Evidence strength / Bridge to H1-H4)
  2. Hypothesis Bridge Table (H1-H4 × paper × ADHD-friendly risk)
  3. Mechanism deep-dive mapped to ADHD Assist constraints

Outputs:
  /Users/ahabmasudsiddiqui/Desktop/IURA/Literature_Review/Annotations/<name>.pdf
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
)
from reportlab.lib.enums import TA_JUSTIFY

OUT_DIR = "/Users/ahabmasudsiddiqui/Desktop/IURA/Literature_Review/Annotations"

styles = getSampleStyleSheet()
title_style = ParagraphStyle(
    "TitleX",
    parent=styles["Title"],
    fontSize=16,
    spaceAfter=10,
    textColor=HexColor("#1a365d"),
)
h1 = ParagraphStyle(
    "H1",
    parent=styles["Heading1"],
    fontSize=13,
    spaceBefore=12,
    spaceAfter=6,
    textColor=HexColor("#2c5282"),
)
h2 = ParagraphStyle(
    "H2",
    parent=styles["Heading2"],
    fontSize=11,
    spaceBefore=8,
    spaceAfter=4,
    textColor=HexColor("#2d3748"),
)
body = ParagraphStyle(
    "Body",
    parent=styles["BodyText"],
    fontSize=10,
    leading=13,
    spaceAfter=4,
    alignment=TA_JUSTIFY,
)
note = ParagraphStyle(
    "Note",
    parent=body,
    fontSize=9,
    textColor=HexColor("#4a5568"),
    italic=True,
)


def build_pdf(out_path, title, subtitle, items, bridge_rows, sections):
    """items: list[(label, text)] for 7-item template.
    bridge_rows: list[list[str]] for H1-H4 table (header + 4 rows).
    sections: list[(heading_text, intro_text, list[(name, defn, mapping)])]."""
    story = []
    story.append(Paragraph(title, title_style))
    story.append(Paragraph(subtitle, body))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Annotated for Ahab's IURA project: "
            "<i>Accessible ADHD-Supportive Interaction in LLM-Based Tutoring Systems</i>",
            note,
        )
    )
    story.append(Spacer(1, 10))

    story.append(Paragraph("1. Seven-Item Annotation Template", h1))
    for label, txt in items:
        story.append(Paragraph(f"<b>{label}.</b> {txt}", body))
        story.append(Spacer(1, 4))
    story.append(Spacer(1, 8))

    story.append(Paragraph("2. Hypothesis Bridge (H1-H4)", h1))
    t = Table(bridge_rows, colWidths=[0.5 * inch, 1.5 * inch, 2.4 * inch, 2.1 * inch])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), HexColor("#2c5282")),
                ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#ffffff")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#cbd5e0")),
                (
                    "ROWBACKGROUNDS",
                    (0, 1),
                    (-1, -1),
                    [HexColor("#f7fafc"), HexColor("#edf2f7")],
                ),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(t)
    story.append(Spacer(1, 12))
    story.append(PageBreak())

    for heading, intro, rows in sections:
        story.append(Paragraph(heading, h1))
        if intro:
            story.append(Paragraph(intro, body))
            story.append(Spacer(1, 6))
        for name, defn, mapping in rows:
            story.append(Paragraph(f"<b>{name}</b>", h2))
            story.append(Paragraph(f"<i>What the paper does:</i> {defn}", body))
            story.append(
                Paragraph(f"<i>=&gt; ADHD Assist mapping:</i> " f"{mapping}", body)
            )
            story.append(Spacer(1, 4))
        story.append(Spacer(1, 8))

    doc = SimpleDocTemplate(
        out_path,
        pagesize=letter,
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        title=title,
    )
    doc.build(story)
    print(f"Wrote {out_path}")


# ----------------------------------------------------------------------
# Paper 2: Can Language Models Teach Weaker Agents?  (NeurIPS 2023)
# Saha, Hase, Bansal (UNC Chapel Hill)
# ----------------------------------------------------------------------


def paper_can_lms_teach():
    title = "Paper Annotation: <i>Can Language Models Teach Weaker Agents?</i>"
    subtitle = (
        "Saha, Hase, Bansal &mdash; <b>NeurIPS 2023</b><br/>"
        "<i>Teacher Explanations Improve Students via Personalization</i>"
    )

    items = [
        (
            "Claim",
            "Teacher LLMs can intervene at test time to improve a weaker "
            "student LLM's reasoning, especially when (a) the teacher is "
            "selective about <i>when</i> to explain (Intervention Function "
            "based on Expected Utility) and (b) <i>how</i> it explains "
            "(Theory-of-Mind personalisation prompts). Multi-round teaching "
            "even improves student performance on future <i>unexplained</i> "
            "examples; misaligned teachers can drag students to random.",
        ),
        (
            "Mechanism",
            "<b>Prompt engineering, no fine-tuning</b>. Two few-shot mental "
            "models built on the teacher: (1) Pre/Post-Intervention Simulation "
            "Prompts that estimate expected utility of an explanation, used to "
            "rank which test items are worth explaining under a budget; (2) "
            "Personalisation Prompt that conditions on a few human "
            "explanations that previously rectified the student's wrong "
            "answer. Multi-round teaching cycles intervene-on-best-points "
            "into the student's in-context demonstrations.",
        ),
        (
            "Target outcome",
            "Student accuracy on reasoning tasks (StrategyQA, GSM8k, "
            "CommonsenseQA) at fixed intervention budget; generalisation to "
            "unexplained items; resilience to misaligned teachers.",
        ),
        (
            "Who/what is the 'student'",
            "<b>Another LLM</b>, deliberately weaker (Flan-T5 vs GPT-3.5 "
            "/ LLaMA pairings). No human learners. The teaching budget is "
            "the % of test points the teacher gets to explain &mdash; a "
            "communication-cost analogue.",
        ),
        (
            "Metrics",
            "Accuracy &Delta; vs. no-intervention baseline; AUC over budget "
            "0&ndash;100%. Construct mapping: budget &asymp; tutor "
            "verbosity / time-on-task; intervention selection &asymp; <i>when "
            "the tutor decides to expand vs. stay terse</i>; personalisation "
            "&asymp; matching response style to the learner.",
        ),
        (
            "Evidence strength",
            "<b>Synthetic, LLM-on-LLM evaluation only.</b> Strong "
            "internal-validity for the algorithmic question (does an "
            "Expected-Utility selector beat random?) and clean ablations. No "
            "humans, no cognitive load, no usability, no learning over "
            "time.",
        ),
        (
            "Your bridge (H1-H4)",
            "<b>H1 (cognitive load &darr;):</b> Budget-aware intervention is "
            "exactly the principle behind progressive disclosure &mdash; "
            "explain only when it pays off, otherwise stay terse. ADHD Assist "
            "should adopt &lsquo;tight default; expand on demand&rsquo;. "
            "<b>H2 (SUS &uarr;):</b> Personalisation prompt &asymp; consistent, "
            "predictable explanation style anchored on what worked before "
            "(repeatability, ease of learning). <b>H3 (comprehension):</b> "
            "Selective intervention shifts cognitive effort to high-payoff "
            "moments &mdash; matches retrieval-practice intuition. "
            "<b>H4 (preference):</b> Misaligned-teacher result is the "
            "strongest argument for an oversight layer in your design: a "
            "single bad system prompt can sink a participant. <b>Failure "
            "mode for ND learners:</b> Expected-Utility selectors trained on "
            "neurotypical signals may underestimate when an ADHD learner "
            "needs scaffolding; you may need a more conservative budget.",
        ),
    ]

    bridge_rows = [
        ["Hyp.", "Claim", "How this paper informs it", "Limit / risk for ADHD"],
        [
            "H1",
            "ADHD Assist &darr; NASA-TLX",
            "Budgeted, selective explanation = progressive disclosure.",
            "Selector tuned on LLM students may not match ADHD signals.",
        ],
        [
            "H2",
            "ADHD Assist &uarr; SUS",
            "Personalisation prompt yields a consistent style learners can " "rely on.",
            "Style consistency is necessary but not sufficient; layout / "
            "length still matter.",
        ],
        [
            "H3",
            "ADHD Assist &uarr; comprehension",
            "Multi-round teaching improves students on unexplained items "
            "&mdash; transfer effect.",
            "Multi-round depth can overload working memory if turns are long.",
        ],
        [
            "H4",
            "ADHD Assist preferred",
            "Misaligned teacher result &rarr; oversight layer is "
            "essential, not optional.",
            "Even well-intentioned tutors may bias toward verbosity if " "unchecked.",
        ],
    ]

    sections = [
        (
            "3. Mechanism mapping &rarr; ADHD Assist constraints",
            "These are the four axes Saha et al. study (RQ1-RQ4 plus RQ5). "
            "Each row shows what the paper does and how it lands in your "
            "design.",
            [
                (
                    "RQ1 - Test-time intervention",
                    "Teacher randomly intervenes on a fraction of items and "
                    "supplies a chain-of-thought explanation in the student's "
                    "in-context prompt.",
                    "ADHD Assist's <b>baseline behaviour</b> should not "
                    "intervene with long explanations on every turn; it should "
                    "answer terse-by-default and expand only when the user signals "
                    "they want more.",
                ),
                (
                    "RQ2 - Intervention Function (Expected Utility)",
                    "Teacher computes p(student is wrong without intervention) - "
                    "p(student is wrong with intervention) using simulation "
                    "prompts; only intervenes on top-utility items.",
                    "Direct analogue of <b>'when to expand'</b>. Use a lightweight "
                    "policy in your oversight layer: only inject extended "
                    "explanation when (i) user asked or (ii) prior turn shows "
                    "confusion signals.",
                ),
                (
                    "RQ3 - Personalisation prompt",
                    "Teacher conditions on a few demonstrations of explanations "
                    "that <i>actually changed</i> the student's answer.",
                    "Your equivalent: maintain a small <b>style exemplar pool</b> "
                    "for ADHD Assist (concise, summary-first, step-ladder) and "
                    "include 1-2 in the system prompt instead of describing the "
                    "style in prose. Stronger empirical signal than rule "
                    "lists.",
                ),
                (
                    "RQ4 - Multi-round teaching",
                    "Best-points + personalised explanations injected as "
                    "few-shot demos; student improves on later unexplained items.",
                    "Implication: <b>session memory matters</b>. Even within a "
                    "single chat session, anchoring the model to its last "
                    "successful structured turn (via a brief in-context summary) "
                    "should keep it on policy without re-stating the full system "
                    "prompt.",
                ),
                (
                    "RQ5 - Misaligned teachers",
                    "An adversarial / misaligned teacher can drag the student "
                    "down to random-chance accuracy.",
                    "<b>Strongest justification for the oversight layer</b>. If "
                    "the upstream model drifts (verbose, off-topic), the second "
                    "pass must catch and rewrite &mdash; otherwise a single bad "
                    "session can flip your hypothesis.",
                ),
            ],
        )
    ]

    build_pdf(
        out_path=f"{OUT_DIR}/CanLMsTeach_Annotation.pdf",
        title=title,
        subtitle=subtitle,
        items=items,
        bridge_rows=bridge_rows,
        sections=sections,
    )


# ----------------------------------------------------------------------
# Paper 3: Multi-turn RL from Preference Human Feedback (NeurIPS 2024)
# Shani et al. (Google Research / DeepMind) - Education Dialogue
# ----------------------------------------------------------------------


def paper_mtpo():
    title = (
        "Paper Annotation: <i>Multi-turn RL from Preference HF</i> "
        "&mdash; Education Dialogue"
    )
    subtitle = (
        "Shani, Rosenberg, Cassel, Lang, Calandriello, Zipori, Noga, "
        "Keller, Piot, Szpektor, Hassidim, Matias, Munos &mdash; "
        "<b>NeurIPS 2024</b><br/>"
        "<i>MTPO: Mirror-descent multi-turn preference optimisation; "
        "introduces the Education Dialogue environment + dataset.</i>"
    )

    items = [
        (
            "Claim",
            "Single-turn RLHF cannot capture long-term effects of individual "
            "tutoring moves (e.g., a question that seems unhelpful turn-by-turn "
            "but is critical to overall learning). MTPO optimises preferences "
            "over <i>full multi-turn conversations</i>, provably converging to "
            "a Nash equilibrium (a policy preferred over any other) and "
            "outperforming single-turn RLHF in their Education Dialogue "
            "environment.",
        ),
        (
            "Mechanism",
            "<b>RL fine-tuning, conversation-level preferences</b>. (1) "
            "Reformulate dialogue as a Contextual MDP with "
            "end-of-conversation preference feedback. (2) MTPO: mirror-descent "
            "policy optimisation + self-play over the full trajectory; uses a "
            "preference-Q function that accounts for long-term effect of each "
            "turn. (3) Educational judge: a <b>constitution</b> of effective-"
            "learning principles drives an LLM-as-judge that returns a single "
            "preference between two whole tutoring conversations.",
        ),
        (
            "Target outcome",
            "Conversation-level preference (does an outside judge prefer this "
            "tutoring trajectory?) on a synthetic teacher-student environment "
            "covering a random topic per episode. Also evaluated on a "
            "Car-Dealer reward-based env to show preference-only learning "
            "can match reward-based learning.",
        ),
        (
            "Who/what is the 'student'",
            "<b>Another LLM, prompted as a student.</b> Gemini is used both "
            "to simulate the student turns and to act as the constitution-"
            "anchored judge of the resulting conversation. No humans.",
        ),
        (
            "Metrics",
            "Win-rate vs. reference policies under the constitution-driven "
            "preference judge; long-term reward in the Car-Dealer env. "
            "Construct mapping: <i>conversation-level preference</i> &asymp; "
            "human gestalt judgment after a tutoring session, similar to your "
            "Page-5 comparison items (Q39-42) but driven by a constitution "
            "rather than human raters.",
        ),
        (
            "Evidence strength",
            "<b>Synthetic / model-judged only.</b> Solid theoretical "
            "guarantees (Nash equilibrium, convergence proofs) and a publicly "
            "released Education-Dialogue dataset. No human learners, no "
            "cognitive-load or usability data. The 'effective learning' "
            "constitution is an interesting artefact you can study.",
        ),
        (
            "Your bridge (H1-H4)",
            "<b>H1 (cognitive load &darr;):</b> The whole point of "
            "trajectory-level optimisation is to reward long-game tutoring "
            "moves &mdash; e.g., a one-line clarifying question early might "
            "save a learner two paragraphs later. Same logic justifies your "
            "summary-first / progressive-disclosure rule even when "
            "turn-by-turn it looks like 'less is given'. <b>H2 (SUS &uarr;):</b> "
            "Constitution-based judging maps to your <i>fixed-rubric "
            "post-condition usability rating</i>. <b>H3 (comprehension):</b> "
            "Multi-turn preference optimisation is the principled way to "
            "actually train this behaviour later (post-IURA). <b>H4 "
            "(preference):</b> Their constitution is a usable scaffold for "
            "writing your own judge if you ever automate evaluation. "
            "<b>Failure mode for ND learners:</b> No cognitive-accessibility "
            "principles in the constitution; would need to add ADHD-specific "
            "items (length cap, structure, redirect-on-drift).",
        ),
    ]

    bridge_rows = [
        ["Hyp.", "Claim", "How this paper informs it", "Limit / risk for ADHD"],
        [
            "H1",
            "ADHD Assist &darr; NASA-TLX",
            "Trajectory-level credit assignment justifies summary-first "
            "moves that look weak turn-by-turn.",
            "Their constitution does not encode load-management; you must " "add it.",
        ],
        [
            "H2",
            "ADHD Assist &uarr; SUS",
            "Constitution-style fixed rubric is exactly how you formalise "
            "your interaction policy.",
            "Synthetic judge is not a human; your study still needs the "
            "Qualtrics SUS.",
        ],
        [
            "H3",
            "ADHD Assist &uarr; comprehension",
            "Education-Dialogue dataset is a ready resource for future "
            "training experiments.",
            "Topics are random; not aligned with course content or "
            "ADHD-typical struggles.",
        ],
        [
            "H4",
            "ADHD Assist preferred",
            "Conversation-level pairwise preference parallels your " "Q39-42 design.",
            "Their preferences are model-judged, yours are self-reported &mdash; "
            "different constructs.",
        ],
    ]

    sections = [
        (
            "3. Concept transfers &rarr; ADHD Assist constraints",
            "Three usable ideas from MTPO and their direct mapping to your "
            "EduAI implementation.",
            [
                (
                    "Constitution-as-policy",
                    "MTPO judges full conversations against a written "
                    "&lsquo;effective learning&rsquo; constitution, then "
                    "optimises the agent toward that constitution.",
                    "Your <b>ADHD Assist system prompt</b> is structurally a "
                    "constitution. Treat it like one: enumerate violations "
                    "(too long; multi-topic; deep-dive without summary; jargon "
                    "spike) and have the oversight layer score against the same "
                    "list before passing the response to the user.",
                ),
                (
                    "Trajectory-level credit assignment",
                    "Reward (or preference) is computed over the whole episode, "
                    "not per turn; mirror-descent updates lift policies that win "
                    "trajectory-wise.",
                    "Justifies UI affordances like <b>'continue' / 'go deeper'</b> "
                    "buttons. A short turn that ends with an explicit invite is "
                    "better trajectory-wise than a long turn that exhausts the "
                    "topic at once &mdash; even if turn 1 looks 'less helpful'.",
                ),
                (
                    "Education-Dialogue dataset",
                    "Released set of teacher-student dialogues on random topics, "
                    "evaluated under their constitution.",
                    "Useful as <b>style few-shot exemplars</b> in your prompt "
                    "(after filtering for length / structure compatible with "
                    "ADHD Assist). Do <i>not</i> use it as ground-truth tutoring "
                    "for your participants &mdash; topics and audience differ.",
                ),
            ],
        )
    ]

    build_pdf(
        out_path=f"{OUT_DIR}/MultiTurnRLHF_Annotation.pdf",
        title=title,
        subtitle=subtitle,
        items=items,
        bridge_rows=bridge_rows,
        sections=sections,
    )


# ----------------------------------------------------------------------
# Paper 4: Nonparametric Teaching for Multiple Learners (NeurIPS 2023)
# Zhang, Cao, Liu, Tsang, Kwok
# ----------------------------------------------------------------------


def paper_mint():
    title = (
        "Paper Annotation: <i>Nonparametric Teaching for Multiple "
        "Learners (MINT)</i>"
    )
    subtitle = (
        "Zhang, Cao, Liu, Tsang, Kwok &mdash; <b>NeurIPS 2023</b><br/>"
        "<i>Vector-valued RKHS framework for teaching several learners at "
        "once; theoretical speed-ups from learner-learner communication.</i>"
    )

    items = [
        (
            "Claim",
            "Existing iterative machine-teaching theory only treats one "
            "learner; in practice teachers often serve a heterogeneous "
            "cohort. MINT generalises nonparametric iterative teaching from "
            "scalar-valued to vector-valued reproducing-kernel Hilbert "
            "spaces, and proves a teaching speed-up when learners share / "
            "communicate intermediate hypotheses.",
        ),
        (
            "Mechanism",
            "<b>Pure theoretical / functional-analysis framework</b>. The "
            "teacher selects examples by gradient descent in a vector-valued "
            "RKHS; each output dimension is one learner. A communication "
            "operator linearly mixes learners' current functions before each "
            "round, accelerating convergence. Validated on synthetic "
            "regression and on the running RGB-image teaching toy.",
        ),
        (
            "Target outcome",
            "Number of teaching rounds to reach a target loss (iterative "
            "teaching dimension). No human users, no NLP. Their contribution "
            "is theoretical efficiency, not pedagogy.",
        ),
        (
            "Who/what is the 'student'",
            "<b>Mathematical learners</b> in a vector-valued RKHS. Each "
            "learner is a scalar-valued target function; multi-learner = "
            "stacked into a vector. No language; no humans; no cognitive "
            "modelling.",
        ),
        (
            "Metrics",
            "Convergence speed (iteration count to reach loss threshold) and "
            "classical RKHS bounds. Construct mapping is <b>weak</b> &mdash; "
            "this is about teaching efficiency in a kernel-method setting, "
            "not about how a person experiences a tutor.",
        ),
        (
            "Evidence strength",
            "<b>Synthetic only, but rigorous.</b> Theorems with proofs and "
            "controlled experiments. The empirical setting (RGB image "
            "teaching) is an illustration, not a study of human learning. "
            "Cite for theoretical framing of <i>heterogeneous learners</i>, "
            "not for any tutoring claim.",
        ),
        (
            "Your bridge (H1-H4)",
            "<b>H1-H3 (load / SUS / comprehension):</b> No direct claim. The "
            "useful analogy is conceptual: when a single tutoring system "
            "serves a population with different cognitive profiles, ignoring "
            "heterogeneity is suboptimal &mdash; this paper formalises why. "
            "<b>H4 (preference):</b> Communication speed-up &asymp; sharing "
            "&lsquo;what worked for similar learners&rsquo; is theoretically "
            "principled, but you do <b>not</b> implement that in your IURA "
            "study (privacy + sample size). <b>Honest framing:</b> Use this "
            "paper as <b>related work / future direction</b>, not as a core "
            "citation for ADHD-specific design. Your bridge is &lsquo;moving "
            "from one-size-fits-all tutors to learner-aware ones is "
            "well-motivated theoretically; ADHD Assist is one concrete "
            "instantiation along that direction.&rsquo;",
        ),
    ]

    bridge_rows = [
        ["Hyp.", "Claim", "How this paper informs it", "Limit / risk for ADHD"],
        [
            "H1",
            "ADHD Assist &darr; NASA-TLX",
            "(Indirect) heterogeneity-aware teaching is provably more "
            "efficient than uniform teaching.",
            "No human / cognitive-load claims; treat as background motivation " "only.",
        ],
        [
            "H2",
            "ADHD Assist &uarr; SUS",
            "(Indirect) per-learner targeting helps usability when the "
            "learner is non-modal.",
            "The paper has nothing to say about UI or usability.",
        ],
        [
            "H3",
            "ADHD Assist &uarr; comprehension",
            "Cohort-aware example selection &asymp; condition-aware response "
            "selection.",
            "Their objective is convergence loss, not human comprehension.",
        ],
        [
            "H4",
            "ADHD Assist preferred",
            "&mdash; (no direct support).",
            "Cite as theoretical framing only; do not over-claim.",
        ],
    ]

    sections = [
        (
            "3. What you cite this paper for &mdash; and what you don't",
            "MINT is the weakest fit of your seven for ADHD-specific design. "
            "Use it sparingly and accurately.",
            [
                (
                    "Cite for: Theoretical framing of learner heterogeneity",
                    "Vector-valued RKHS lets one teacher target N learner "
                    "functions simultaneously, with provable efficiency.",
                    "In Form A's Significance section, you can write that "
                    "<i>moving from single-policy tutoring to "
                    "population-aware tutoring</i> is well-motivated even from a "
                    "purely theoretical standpoint; ADHD Assist is one concrete "
                    "instantiation for one population.",
                ),
                (
                    "Cite for: Communication / shared schemas",
                    "Letting learners share intermediate hypotheses speeds up "
                    "convergence in MINT.",
                    "Distant analogue of curated, cohort-tested style exemplars "
                    "(see <i>Can LMs Teach</i>'s personalisation prompt). Do not "
                    "claim direct support; mention only as &lsquo;structural "
                    "parallel.&rsquo;",
                ),
                (
                    "Do <b>not</b> cite for: Pedagogy or cognitive load",
                    "Paper makes no claims about humans, cognition, ADHD, "
                    "language, or interaction design.",
                    "Avoid using MINT in your Methodology or Discussion as if it "
                    "validated any user-facing design decision; reviewers in "
                    "education / accessibility venues will spot the over-reach.",
                ),
            ],
        )
    ]

    build_pdf(
        out_path=f"{OUT_DIR}/MINT_Annotation.pdf",
        title=title,
        subtitle=subtitle,
        items=items,
        bridge_rows=bridge_rows,
        sections=sections,
    )


# ----------------------------------------------------------------------
# Paper 5: Language Models as Science Tutors (ICML 2024)
# Chevalier et al. (Princeton et al.)
# ----------------------------------------------------------------------


def paper_science_tutors():
    title = "Paper Annotation: <i>Language Models as Science Tutors</i>"
    subtitle = (
        "Chevalier, Geng, Wettig, Chen, ... Chen &mdash; <b>ICML 2024</b><br/>"
        "<i>TutorEval (long-context QA benchmark) + TutorChat (80K synthetic "
        "long dialogues) + Llemma-7B/34B-MathMix tutors.</i>"
    )

    items = [
        (
            "Claim",
            "Existing math/science benchmarks (GSM8K, MATH) test final-answer "
            "accuracy on short problems and miss real tutoring use-cases: "
            "long textbook context, free-form generation, asking for "
            "background. The authors (1) build TutorEval, an expert-written "
            "long-context QA benchmark with key-point annotations; (2) build "
            "TutorChat, an 80K synthetic long-form dialogue dataset; (3) "
            "fine-tune Llemma 7B/34B with a MathMix recipe to compete with "
            "much larger closed models.",
        ),
        (
            "Mechanism",
            "<b>Benchmark + dataset + fine-tuning</b>. TutorEval is graded by "
            "GPT-4 against human-written 'key points' for each item, "
            "decoupling reasoning quality from final-answer correctness. "
            "TutorChat is generated by GPT-3.5/4 conditioned on textbook "
            "chapters. Fine-tune Llemma with mixtures of TutorChat + math "
            "data; show that pure dialogue-tuning hurts science accuracy and "
            "MathMix recovers it.",
        ),
        (
            "Target outcome",
            "Long-context tutoring quality (a free-form, key-point-graded "
            "metric) and standard math-reasoning accuracy (MATH, GSM8K). "
            "Implicitly: closing the gap between 'good problem solver' and "
            "'good tutor.'",
        ),
        (
            "Who/what is the 'student'",
            "There is no learner in the loop. <b>The 'student' is the "
            "benchmark question writer's persona</b>; the tutor's output is "
            "judged by GPT-4 with key-point sketches from the (human) "
            "domain expert.",
        ),
        (
            "Metrics",
            "TutorEval score (LM-as-evaluator + key points), MATH/GSM8K "
            "accuracy. Construct mapping: TutorEval &asymp; expert-rated "
            "<i>completeness + accuracy</i>; <b>not</b> learner-perceived "
            "comprehension. Closer to your researcher-developed comprehension "
            "items than to NASA-TLX/SUS.",
        ),
        (
            "Evidence strength",
            "<b>Strong on benchmark, weak on humans.</b> Carefully built "
            "expert benchmark with key points and inter-rater checks. No "
            "human learners; no usability or load measurement. Useful for "
            "you as <i>existence proof</i> that fine-tuning for tutoring "
            "behaviour is non-trivial &mdash; existing dialogue datasets hurt "
            "tutoring quality unless you mix in domain content.",
        ),
        (
            "Your bridge (H1-H4)",
            "<b>H1 (cognitive load &darr;):</b> Long-context capability "
            "matters because students paste lecture notes; ADHD Assist on "
            "top of a long-context model lets you keep extraneous load low "
            "<i>without</i> dropping coverage. Pair Llemma-style tutors with "
            "your structuring policy. <b>H2 (SUS &uarr;):</b> TutorEval shows "
            "that 'usable scientific assistant' is a measurable target, "
            "supporting your SUS framing. <b>H3 (comprehension):</b> "
            "Key-point-graded answers map onto your three Likert "
            "comprehension items: rate against the lecture's key points, "
            "not against an answer string. <b>H4 (preference):</b> Their "
            "result that pure dialogue-tuning <i>hurts</i> tutoring is a "
            "warning shot for naive prompt-only ADHD Assist &mdash; the "
            "oversight layer must protect against style-drift away from "
            "subject correctness.",
        ),
    ]

    bridge_rows = [
        ["Hyp.", "Claim", "How this paper informs it", "Limit / risk for ADHD"],
        [
            "H1",
            "ADHD Assist &darr; NASA-TLX",
            "Long-context tutors keep coverage; ADHD Assist trims style "
            "without dropping content.",
            "Long contexts can themselves overload working memory; you "
            "control output length, not input length.",
        ],
        [
            "H2",
            "ADHD Assist &uarr; SUS",
            "TutorEval frames 'real-life usability of LM tutors' as "
            "explicitly measurable.",
            "Their usability is rater-judged, yours is self-reported &mdash; "
            "different constructs.",
        ],
        [
            "H3",
            "ADHD Assist &uarr; comprehension",
            "Key-point grading is a clean template for your three Likert "
            "comprehension items.",
            "GPT-4 graded; your participants self-rate &mdash; you cannot "
            "reuse their judge.",
        ],
        [
            "H4",
            "ADHD Assist preferred",
            "Style-tuning can hurt accuracy &mdash; oversight layer " "needed.",
            "Single-pass prompt-only ADHD Assist may degrade subject "
            "fidelity if not checked.",
        ],
    ]

    sections = [
        (
            "3. Concept transfers &rarr; ADHD Assist constraints",
            "Three usable ideas from this paper for your study and product.",
            [
                (
                    "Key-point grading",
                    "Each TutorEval item is paired with expert-written key points "
                    "(facts the answer must cover); GPT-4 grades coverage.",
                    "Adapt as a <b>QA checklist</b> for your three standardised "
                    "prompts: list the 3-5 key points each correct response must "
                    "convey. Use it (a) for QA before participant runs to verify "
                    "both modes cover the same key points, and (b) optionally as "
                    "a structure for your researcher-developed comprehension "
                    "items.",
                ),
                (
                    "MathMix data recipe (style + content)",
                    "Pure dialogue-tuning hurt science accuracy; mixing dialogue "
                    "with math data preserved both tutoring style and "
                    "subject-matter rigor.",
                    "Direct lesson for ADHD Assist: do not implement style as "
                    "<i>style-only</i> instructions. <b>Pair</b> the style rules "
                    "with concrete subject-correct exemplars that already obey "
                    "the rules, otherwise the model trades correctness for "
                    "structure.",
                ),
                (
                    "Real-life usability framing",
                    "TutorEval is positioned as measuring 'real-life usability "
                    "of LMs as scientific assistants', distinct from "
                    "problem-solving accuracy.",
                    "Reinforces your study's framing: usability (SUS) and "
                    "perceived load (TLX) are <i>not</i> downstream of "
                    "answer-correctness; they are independent and measurable. "
                    "Cite this paper to defend why benchmark scores are not "
                    "enough for your IURA contribution.",
                ),
            ],
        )
    ]

    build_pdf(
        out_path=f"{OUT_DIR}/ScienceTutors_Annotation.pdf",
        title=title,
        subtitle=subtitle,
        items=items,
        bridge_rows=bridge_rows,
        sections=sections,
    )


# ----------------------------------------------------------------------
# Paper 6: LEAP - Better than Your Teacher (ICLR 2025)
# Choudhury, Sodhi (Cornell)
# ----------------------------------------------------------------------


def paper_leap():
    title = "Paper Annotation: <i>LEAP &mdash; Better than Your Teacher</i>"
    subtitle = (
        "Choudhury, Sodhi &mdash; <b>ICLR 2025</b><br/>"
        "<i>LLM agents that learn from privileged AI-expert feedback at "
        "training time, then deploy without privilege.</i>"
    )

    items = [
        (
            "Claim",
            "Weak student LLM agents can outperform stronger teacher LLMs on "
            "decision-making tasks if the teacher has access to "
            "<i>privileged state</i> (information available only at training "
            "time). LEAP iteratively fine-tunes the student on the teacher's "
            "corrected reason-action trajectories; even when the teacher is "
            "the same weak model with privilege, the trained student "
            "improves.",
        ),
        (
            "Mechanism",
            "<b>Iterative imitation learning with privileged feedback</b>. "
            "Loop: (1) student rolls out trajectories in the environment; "
            "(2) privileged teacher reads the trajectory, sees hidden state "
            "(e.g., object locations, intermediate subgoals), produces "
            "corrected reason and action labels; (3) SFT/DPO update on the "
            "corrected dataset; (4) repeat. Theory: success depends on "
            "balancing privilege (information gap) with student "
            "realisability (capacity to express the corrected policy).",
        ),
        (
            "Target outcome",
            "Task success on ALFWorld (text-based games), WebShop (web "
            "navigation), Intercode-Bash (interactive coding). Not education; "
            "the relevance is purely <i>methodological</i>: how to operationalise "
            "an oversight teacher that improves the student over rounds.",
        ),
        (
            "Who/what is the 'student'",
            "<b>Another LLM agent</b> (e.g., Llama-3-8B). The teacher is "
            "another LLM (often GPT-4o or a privileged version of the student "
            "itself). No humans.",
        ),
        (
            "Metrics",
            "Task success rate; comparison to behaviour cloning, ReAct, "
            "Reflexion baselines. Construct mapping: <i>privileged teacher "
            "&asymp; oversight layer that knows your policy and can edit "
            "the student response</i>; <i>student improvement &asymp; "
            "fine-tuning later, after IURA, on logged oversight rewrites</i>.",
        ),
        (
            "Evidence strength",
            "<b>Strong methodological evidence on three benchmarks.</b> "
            "Includes theory section explaining when privilege helps. Not "
            "about humans, education, or ADHD. The valuable artefact for you "
            "is the recipe: have the oversight model rewrite the agent's "
            "trace, then later use those rewrites as fine-tuning data.",
        ),
        (
            "Your bridge (H1-H4)",
            "<b>H1-H3 (load / SUS / comprehension):</b> Indirect. LEAP shows "
            "that an oversight model with extra context can systematically "
            "improve a deployed model. Your second-pass oversight in EduAI "
            "is exactly the inference-time analogue. <b>H4 (preference):</b> "
            "Indirect. <b>Direct lift:</b> If you want to keep IURA scope "
            "narrow, run inference-time oversight only. After the study, the "
            "logged (input, raw output, oversight rewrite) tuples become a "
            "natural LEAP-style dataset to fine-tune a smaller, "
            "ADHD-Assist-native model. Cite LEAP as evidence that this is a "
            "principled second phase.",
        ),
    ]

    bridge_rows = [
        ["Hyp.", "Claim", "How this paper informs it", "Limit / risk for ADHD"],
        [
            "H1",
            "ADHD Assist &darr; NASA-TLX",
            "(Indirect) Oversight rewrites tighten the response &mdash; " "less load.",
            "Adds latency; if visible, may hurt perceived efficiency on SUS.",
        ],
        [
            "H2",
            "ADHD Assist &uarr; SUS",
            "(Indirect) Oversight enforces style consistency turn after " "turn.",
            "Two-stage pipelines can produce inconsistencies if the rewrite "
            "step changes meaning.",
        ],
        [
            "H3",
            "ADHD Assist &uarr; comprehension",
            "(Indirect) Privileged teacher can inject structure; analogous "
            "to your style rubric.",
            "Privileged information in your case is just the policy &mdash; "
            "no real new info, so gains may be smaller than LEAP's.",
        ],
        [
            "H4",
            "ADHD Assist preferred",
            "(Methodological) Logged rewrites become future training data.",
            "Not a substitute for human evaluation; do not skip the survey.",
        ],
    ]

    sections = [
        (
            "3. Direct architectural transfer &rarr; ADHD Assist oversight",
            "LEAP is the closest existing template for your second-AI-oversight "
            "layer (alongside SocraticLM's Dean). Key differences and "
            "transfers:",
            [
                (
                    "LEAP teacher reads full trajectory",
                    "The privileged expert sees the entire trajectory before "
                    "producing corrections; not a per-turn judge.",
                    "Implication for EduAI: your oversight should see the "
                    "<b>full draft response</b>, not stream tokens. Run it "
                    "as a second non-streaming call after the first pass "
                    "completes (or after a tool-use sequence).",
                ),
                (
                    "Privileged state vs. visible state",
                    "The teacher knows things the student does not (object "
                    "positions, subgoals).",
                    "Your oversight's 'privilege' is the <b>complete ADHD Assist "
                    "policy and the survey-task structure</b>. Encode them once "
                    "in the oversight system prompt; do not try to fit them "
                    "into the user-facing tutor's prompt at the same time.",
                ),
                (
                    "Iterative SFT/DPO loop",
                    "After each round, the student is fine-tuned on corrected "
                    "trajectories and the loop repeats.",
                    "<b>Out of scope for IURA</b>, but worth designing for: log "
                    "(input, draft, rewrite) tuples (with no PII / consistent with "
                    "your ethics narrative). Post-study, these become a "
                    "high-quality SFT/DPO corpus to fine-tune a smaller "
                    "ADHD-Assist-native model.",
                ),
                (
                    "Realisability constraint",
                    "If the gap between teacher and student is too large, the "
                    "student cannot match the corrected policy.",
                    "Practical implication: keep the gap between baseline-tutor "
                    "and oversight-rewrite small. Same model, different system "
                    "prompt is safer than two different model families.",
                ),
            ],
        )
    ]

    build_pdf(
        out_path=f"{OUT_DIR}/LEAP_Annotation.pdf",
        title=title,
        subtitle=subtitle,
        items=items,
        bridge_rows=bridge_rows,
        sections=sections,
    )


# ----------------------------------------------------------------------
# Paper 7: Students Rather Than Experts (ICLR 2025)
# Ma et al. - SOE / LVSA
# ----------------------------------------------------------------------


def paper_lvsa():
    title = (
        "Paper Annotation: <i>Students Rather Than Experts</i> " "&mdash; LVSA / SOE"
    )
    subtitle = (
        "Ma et al. &mdash; <b>ICLR 2025</b><br/>"
        "<i>Modeling LLM-based Virtual Student Agents (LVSA) with "
        "personality-driven cognitive variability for pre-service teacher "
        "training; SOE pipeline = Scene + Object + Evaluation.</i>"
    )

    items = [
        (
            "Claim",
            "AI4Education has overwhelmingly modelled <i>teachers</i>; "
            "<i>students</i> are mostly pre-scripted. Modelling realistic, "
            "personality-driven student agents (LVSA) is harder but has "
            "value for pre-service teacher training. The SOE pipeline "
            "(Scene = which scenarios LLMs handle, Object = LoRA-fine-tuned "
            "personality-loaded agents, Evaluation = combined human + GPT-4 "
            "judge) demonstrates LLMs <i>can</i> generate human-like, "
            "individually-variable virtual students.",
        ),
        (
            "Mechanism",
            "<b>Dataset curation + LoRA fine-tuning + dual-judge "
            "evaluation</b>. (1) Scene: probe baseline LLMs on language-"
            "learning scenarios. (2) Object: build a dataset of teacher-"
            "student dialogues parameterised by Big-Five personality traits "
            "(extraversion, neuroticism, openness, agreeableness, "
            "conscientiousness) plus question types and learning stages; "
            "fine-tune via LoRA. (3) Evaluation: subjective human ratings + "
            "GPT-4 ratings, validated to correlate.",
        ),
        (
            "Target outcome",
            "Authenticity / human-likeness of the simulated student; "
            "personality-trait fidelity; usefulness for teacher training. "
            "Note: the agent is the student, not the tutor.",
        ),
        (
            "Who/what is the 'student'",
            "<b>The simulated student is the model under study</b>. The "
            "(human) teachers in training are the downstream users. "
            "Personality variability is the explicit modelling target. "
            "<i>Important note for your project: this paper is about "
            "simulating diverse learners, not building accessibility for "
            "real diverse learners.</i>",
        ),
        (
            "Metrics",
            "Multi-dimensional human ratings of authenticity, personality "
            "fidelity, hesitations, self-corrections; GPT-4 ratings on the "
            "same axes; correlation between the two. Construct mapping: "
            "their human ratings are closest to your <i>open-ended thematic "
            "answers (Q43-46)</i> &mdash; not your TLX/SUS scales.",
        ),
        (
            "Evidence strength",
            "<b>Mixed.</b> Solid pipeline and the human-vs-GPT-4 alignment "
            "result is non-trivial. Personality traits are operationalised "
            "via Big Five, which is a deliberate choice (could also have "
            "used learning-disability profiles). The paper acknowledges "
            "subjective evaluation challenges. Evidence is on simulated "
            "student authenticity, not on tutor effectiveness or human "
            "outcomes.",
        ),
        (
            "Your bridge (H1-H4)",
            "<b>H1-H3 (load / SUS / comprehension):</b> Indirect. The paper "
            "establishes that LLMs <i>can</i> simulate non-modal learners &mdash; "
            "useful for designing your <b>oversight tests</b>. <b>H4 "
            "(preference):</b> Indirect. <b>Direct lift:</b> Use the SOE "
            "pipeline to build a small set of <b>simulated ADHD-trait "
            "students</b> for offline regression testing of ADHD Assist "
            "(distractibility, working-memory limits, frustration). This is "
            "<i>QA infrastructure</i>, not human-subjects research; it does "
            "not replace your IURA study. <b>Failure mode for ND learners:</b> "
            "Big-Five is a personality framework, not a clinical or "
            "neurodivergence framework; do not claim to simulate ADHD "
            "from Big Five alone.",
        ),
    ]

    bridge_rows = [
        ["Hyp.", "Claim", "How this paper informs it", "Limit / risk for ADHD"],
        [
            "H1",
            "ADHD Assist &darr; NASA-TLX",
            "(Indirect) Simulated diverse students enable QA tests of load-"
            "reduction policies.",
            "Big Five &ne; ADHD; simulation cannot replace the human study.",
        ],
        [
            "H2",
            "ADHD Assist &uarr; SUS",
            "(Indirect) Validated dual-rater design supports their judges; "
            "you still need human SUS.",
            "GPT-4 rating not interchangeable with self-reported SUS.",
        ],
        [
            "H3",
            "ADHD Assist &uarr; comprehension",
            "(Indirect) Personality-driven struggles are a useful test " "battery.",
            "Comprehension is yours to measure on humans, not on agents.",
        ],
        [
            "H4",
            "ADHD Assist preferred",
            "(Indirect) SOE shows preference judgments correlate " "human/GPT-4.",
            "Avoid claiming SOE itself supports ADHD-specific design.",
        ],
    ]

    sections = [
        (
            "3. Concept transfers &rarr; ADHD Assist (mostly QA infrastructure)",
            "Three concrete ways to use this paper without overstating its " "scope.",
            [
                (
                    "Use as: simulated-learner QA",
                    "SOE-style fine-tuned student agents reproduce hesitations, "
                    "self-corrections, frustration patterns under controlled "
                    "personality settings.",
                    "Build 3-4 lightweight simulated students (e.g., "
                    "&lsquo;easily distracted&rsquo;, &lsquo;low working "
                    "memory&rsquo;, &lsquo;frustrates fast&rsquo;) and run them "
                    "against baseline vs ADHD Assist tutors. Measure violations "
                    "(length cap exceeded, off-topic, multi-topic answer). This "
                    "is product-side QA, not research data.",
                ),
                (
                    "Use as: dual-rater evaluation pattern",
                    "Human ratings + GPT-4 ratings on the same axes, validated "
                    "to correlate.",
                    "If you ever automate analysis of your open-ended responses "
                    "(Q43-46) at scale, validate the model rater against a "
                    "subset of your own thematic codes &mdash; same playbook "
                    "they use.",
                ),
                (
                    "Do <b>not</b> use as: clinical evidence about ADHD",
                    "Personality variation is Big-Five-based, not clinical "
                    "ADHD; paper does not deal with neurodivergence.",
                    "In Form A / Significance, do not cite this paper as "
                    "support for designing for ADHD specifically. Cite it for "
                    "&lsquo;methods that simulate learner heterogeneity for "
                    "tutor evaluation.&rsquo;",
                ),
            ],
        )
    ]

    build_pdf(
        out_path=f"{OUT_DIR}/StudentsRatherThanExperts_Annotation.pdf",
        title=title,
        subtitle=subtitle,
        items=items,
        bridge_rows=bridge_rows,
        sections=sections,
    )


if __name__ == "__main__":
    paper_can_lms_teach()
    paper_mtpo()
    paper_mint()
    paper_science_tutors()
    paper_leap()
    paper_lvsa()
    print("Done.")
