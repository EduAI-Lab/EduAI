export interface TeamMember {
  id: number;
  role: "professor" | "student";
  name: string;
  /** Actual position/role name, shown as the roster card's corner tag, e.g. "Professor", "Developer", "Project Lead". */
  position: string;
  /** The part of the system this member owns, shown under the name, e.g. "Backend & Infra". */
  title: string;
  image: string;
  biography: string;
  contribution: string;
  techStack: string[];
  codeSnippet: string;
  imagePosition?: string;
}

export const teamMembers: TeamMember[] = [
  {
    id: 1,
    role: "professor",
    name: "Dr. Abdallah Mohamed",
    position: "Professor",
    title: "AI Research Director",
    image: "/AbdullahMoh.jpeg",
    biography:
      "Professor Abdallah Mohamed's expertise spans software engineering, decision support systems, and creative higher education. His research integrates optimization techniques, expert systems, and component-based software development to enhance decision-making in complex, uncertain, and dynamic environments. Beyond technical research, he is committed to advancing innovation in teaching and learning, developing new methodologies to foster creativity, engagement, and personalized learning experiences.",
    contribution:
      "Directs AI research, managing model selection and experiments with students to optimize LLM and RAG performance for EduAI.",
    techStack: ["Machine Learning", "Deep Learning", "RAG", "LLMs", "Parallel Computing"],
    codeSnippet:
      "Awarded 2023 IKBFOS Grant for innovative courseware advancing computer programming education.",
  },
  {
    id: 2,
    role: "professor",
    name: "Dr. Mostafa Mohamed",
    position: "Professor",
    title: "Backend & Infra Lead",
    image: "/MohMustafa.jpeg",
    biography:
      "Professor Mostafa Mohamed, previously an Assistant Professor of Biomedical Engineering and now a Computer Science Professor at UBCO, advances research in AI, machine learning, and medical imaging. His notable contributions include white blood cell segmentation, leukemia detection, deep learning–based scene analysis, and human cell classification. With 500+ citations and more than a dozen publications at IEEE, he integrates hardware acceleration, parallel computing, and cloud systems to enhance healthcare diagnostics.",
    contribution:
      "Leads backend development and guides students in building scalable AI infrastructure using LLMs and RAG pipelines for EduAI.",
    techStack: ["Big Data", "GPU acceleration", "Cloud Computing", "Medical Image Processing"],
    codeSnippet:
      "500+ citations pioneering AI medical image analysis, leukemia detection, and published at IEEE.",
  },
  {
    id: 3,
    role: "professor",
    name: "Dr. Fatemeh Fard",
    position: "Assistant Professor",
    title: "FARD Lab · Code LLMs",
    image: "/Fatemah.jpeg",
    biography:
      "Assistant Professor in Computer Science and Data Science at UBC Okanagan, leading the FARD Lab (Foundational AIware Research and Development). Her research focuses on AI-driven software engineering, large language models for code, and NLP applications in low-resource programming languages.",
    contribution:
      "Leads research on adapter-based fine-tuning for low-resource programming languages, exploring transfer learning techniques to improve code intelligence. She has published extensively on code summarization, code clone detection, and the intersection of AI and software development.",
    techStack: [
      "Python",
      "PyTorch",
      "Transformers",
      "HuggingFace",
      "NLP",
      "LLMs",
      "Data Visualization",
    ],
    codeSnippet:
      "from transformers import AutoModel, AutoTokenizer; model = AutoModel.from_pretrained('microsoft/codebert-base'); tokenizer = AutoTokenizer.from_pretrained('microsoft/codebert-base'); inputs = tokenizer('def example(): return True', return_tensors='pt'); outputs = model(**inputs)",
  },
  {
    id: 4,
    role: "professor",
    name: "Dr. Ramon Lawrence",
    position: "Professor",
    title: "Dept. Head · Databases",
    image: "/Ramon_Law.jpeg",
    biography:
      "Professor and Department Head of Computer Science and Data Science at UBC Okanagan. His research spans database systems, data integration, and sensor/IoT data management. He is also the founder of Unity Data Inc., the developer of UnityJDBC—a system that enables SQL queries across heterogeneous data sources.",
    contribution:
      "Directed the Distributed Database Lab, advanced query optimization algorithms, and developed the UnityJDBC driver integrating relational and NoSQL data. His work bridges academic research and industry by providing scalable database solutions and mentoring numerous software engineering students.",
    techStack: ["PostgreSQL", "MySQL", "MongoDB", "Java", "JDBC", "C/C++", "SQL Optimization"],
    codeSnippet:
      "try (Connection conn = DriverManager.getConnection(url, user, pass)) { Statement stmt = conn.createStatement(); ResultSet rs = stmt.executeQuery('SELECT * FROM students'); while (rs.next()) { System.out.println(rs.getString('name')); } }",
  },
  {
    id: 5,
    role: "student",
    name: "Ronit Buti",
    position: "Developer",
    title: "Founding Full-Stack Dev",
    image: "/ronit.jpg",
    biography:
      "Ronit is an Honours Computer Science student who built EduAI, including a provider-agnostic model registry and a pgvector-backed retrieval layer that grounds answers in uploaded course materials.",
    contribution:
      "Led full-stack development of the platform including auth, UI, backend, and RAG pipeline, while architecting extensible tool interfaces for web search and document retrieval.",
    techStack: ["React", "TypeScript", "Next.js", "Prisma", "AI SDK"],
    codeSnippet:
      "generateText({ model: 'openai/gpt-5.2', prompt: 'You are a helpful assistant.' })",
  },
  {
    id: 6,
    role: "student",
    name: "Stavan Shah",
    position: "Developer",
    title: "Backend & API",
    image: "/Stavan.jpeg",
    biography:
      "Stavan is an Honours Computer Science student specializing in AI-driven software engineering and RAG systems. He previously worked on Courseplanner, a course advising chatbot for UBC, and an automated configuration agent. His current research focuses on 'Supervisory AI' architectures, designing multi-agent systems where a secondary model validates pedagogical feedback to ensure accuracy and educational value.",
    contribution:
      "Manages the backend API and database architecture. He ensures that all server-side operations are secure, scalable, and properly integrated with the application's data models.",
    techStack: ["React", "TypeScript", "Go", "Django", "Angular", "PostgreSQL"],
    codeSnippet: "rm -rf node_modules && npm install && pray",
  },
  {
    id: 7,
    role: "student",
    name: "Ahab Masud Siddiqui",
    position: "Developer",
    title: "System Design & UX",
    image: "/ahab.jpg",
    biography:
      "Ahab is an International Undergraduate Research Award recipient for 2026, working on an ADHD-assistive tutoring platform for neurodivergent learners, and is a lead software developer for EduAi.",
    contribution:
      "Ahab built EduAI's assistive tutoring chatbot to rethink how answers reach students with ADHD and learning differences. It intercepts and restructures tutor responses into short, digestible chunks before students see them, quietly reducing cognitive load for the learners who need it most. He also shaped EduAI into a platform anyone across any discipline can actually use, grounding every decision in UDL principles and UBCO accessibility standards. His work spans the full stack: requirements gathering, RBAC across 3 monorepos, UI/UX redesign, and AWS Bedrock as a fallback when UBC's GPUs hit their limit.",
    techStack: ["RR7", "Node.js", "TypeScript", "PostgreSQL", "Prisma", "AWS Bedrock"],
    codeSnippet:
      "While(vibe=true) { clauding(); synthesizing();orchestrating();cultivating(); germinating(); }",
  },
  {
    id: 8,
    role: "student",
    name: "Necmi Kaan Sapoglu",
    position: "Developer",
    title: "Backend & APIs",
    image: "/kaan.png",
    biography:
      "An undergraduate from Turkey with a great interest in AI used in education, as well as a personal interest in video game development. In the EduAI project, he helps develop the backend infrastructure, developing the database, and handling API calls.",
    contribution:
      "Developed backend infrastructure, managed databases, and implemented API integrations, while exploring applications of AI in education and maintaining a strong personal interest in video game development.",
    techStack: ["Backend Architecture", "Software Development", "APIs", "ReactRouter"],
    codeSnippet: "if (working == true){take a break;}else{take a break;}",
  },
  {
    id: 9,
    role: "student",
    name: "Ribhav Sharma",
    position: "Developer",
    title: "Learning Systems",
    image: "/rib.jpeg",
    biography:
      "Ribhav Sharma is a 4th-year Computer Science student who has demonstrated a strong aptitude for AI and software development. He contributed to the EduAI project, focusing on enhancing the platform's learning capabilities and user-interaction framework. Ribhav brings a blend of academic rigor and hands-on development experience, making him an asset in building innovative tech solutions.",
    contribution:
      "Contributed to EduAI: improved core learning algorithms and enhanced user-interaction systems.",
    techStack: ["Java", "Python", "Machine Learning", "React", "Node.js"],
    codeSnippet: "while( internship_game == up ) {chills}",
    imagePosition: "object-center",
  },
  {
    id: 10,
    role: "student",
    name: "Leila Saparbek",
    position: "Developer",
    title: "Backend & Data Pipelines",
    image: "/Leila.jpg",
    biography:
      "Fourth-year Computer Science and Data Science student at UBC Okanagan. Interested in backend development, data pipelines, and applying machine learning to solve real-world problems.",
    contribution:
      "Volunteer Research Assistant contributing to backend infrastructure development and data architecture design. Responsible for implementing API endpoints and database integration, with a focus on designing efficient data pipelines that ensure seamless information flow throughout the system using React Router 7 and PostgreSQL.",
    techStack: ["Python", "SQL", "Node.js", "APIs", "React Router 7", "PostgreSQL"],
    codeSnippet: "while self.at(UBC): self.study() self.code() self.drink(RedBull)",
  },
  {
    id: 11,
    role: "student",
    name: "Mohamed Gamal Sakr",
    position: "Project Manager",
    title: "Lead AI Engineer & PM",
    image: "/sakr.jpg",
    biography:
      "Mohamed Gamal Sakr is an honours Computer Science student at UBC Okanagan specializing in agentic AI and machine learning. He has industry experience from a software engineering internship at Allianz and currently develops LLM-based code vulnerability tools at UBCO. As a student leader and former president-elect of the Computer Science Course Union, he has earned the Dean's List (2025) and UBC's Outstanding International Student Award (2022). His project excellence was recognized with the Database Web Development Badge (2024). He also holds professional certifications from Stanford and Harvard, focusing on applying advanced AI research to practical, real-world systems.",
    contribution:
      "Lead AI Engineer & Project Manager who integrated a Retrieval-Augmented Generation (RAG) engine and production-grade vector database into the core platform while also directing the project lifecycle — from planning and technical design to task management and team coordination — ensuring timely delivery and alignment between engineering, research, and product stakeholders.",
    techStack: ["Machine Learning", "Agentic AI", "LLMs"],
    codeSnippet: "if (hardwork) then dubs",
  },
  {
    id: 12,
    role: "student",
    name: "Syed Saad Ali",
    position: "Developer",
    title: "Question Maker Lead",
    image: "/saad.jpeg",
    biography:
      "Syed Saad Ali is a fourth year computer science student who created the question maker project, dedicated towards assisting professors in creating assessment variations to in their respective courses. He is currently working on a research project for adaptive AI model routing, dedicated towards routing AI prompts to appropriate AI models to optimize educational value and energy use. He is keen on exploring how computer science can improve sustainable impact through well designed systems.",
    contribution:
      "Full stack development on Question Maker (Deployment, apis, tests, database, UI, components).",
    techStack: ["Docker", "React", "PostgreSQL", "Typescript", "Vibe Coding"],
    codeSnippet: "while laptop.status != 418: spawn(worktree(), agent())",
  },
  {
    id: 13,
    role: "student",
    name: "Abdullah Mohsin Naqvi",
    position: "Developer",
    title: "Backend & Infra",
    image: "/abdu.jpeg",
    biography:
      "Abdullah is a third-year Computer Science Co-op student at UBC Okanagan focused on backend and infrastructure. He built a Redis-compatible key-value store from scratch in C11 hitting over 1.3M RPS on SET/GET, and a React-based therapy booking platform that's been live in production for over a year. He recently wrapped a backend internship at Systems Limited working on cache invalidation and rate limiting, and writes about his projects at naqvi.dev.",
    contribution:
      "Worked on the core platform development and implemented backend architecture and system design features to enhance user experience on EduAI.",
    techStack: ["React", "TypeScript", "C", "Node.js", "Redis", "MongoDB"],
    codeSnippet: "if (living) { code(); } else { prompt(); }",
  },
  {
    id: 14,
    role: "student",
    name: "Evan Bowness",
    position: "Developer",
    title: "Systems & Architecture",
    image: "/evan.jpg",
    biography:
      "Evan is a third-year Computer Science student at UBC Okanagan interested in system design and architecture. His background includes work in the Minecraft modding community, and writing enterprise software using VB.net, Python, FastAPI, and Next.js. You can find his personal site at evanbowness.dev.",
    contribution:
      "Worked on the monorepo migration, platform centralization, backend test suites, documentation, and bugfixes.",
    techStack: ["Java", "React", "C#", "Python", "C++", "Prisma"],
    codeSnippet: "if fps != 60 { fps = 60 }",
  },
  {
    id: 15,
    role: "student",
    name: "Ye Thway Aung",
    position: "Developer",
    title: "Frontend, Security & Testing",
    image: "/ye.jpeg",
    biography:
      "Ye is a fourth-year Computer Science Co-op student at UBC Okanagan. He worked as a software developer on the EduAI project, focusing on frontend, security, and testing.",
    contribution:
      "Developed the shared UI library, the testing and CI framework, and audited and fixed security bugs across the system.",
    techStack: [
      "React",
      "Node.js",
      "Python",
      "Java",
      "PostgreSQL",
      "Playwright",
      "Prisma",
      "Docker",
    ],
    codeSnippet: 'if (reviewRequested) { return "LGTM" }',
  },
  {
    id: 16,
    role: "student",
    name: "Al-Ameen Oludare",
    position: "Developer",
    title: "Full-Stack & QA",
    image: "",
    biography:
      "Fourth-year Computer Science student at UBC Okanagan. Interested in full-stack development, reliable APIs, and building software that people will actually use.",
    contribution:
      "Built and hardened features across EduAI Core, Question Maker, and AI Tutor, including Canvas and question-bank workflows, access-control and RBAC fixes, and AI Tutor admin/lesson flows. Strengthened platform reliability with pairwise (PICT) contract tests, end-to-end workflow coverage, and CI-facing quality work so cross-app changes stay secure and mergeable.",
    techStack: ["React", "Node.js", "Python", "Java", "PostgreSQL", "Playwright", "Docker"],
    codeSnippet: "while (otherPR.merged) { pray(noConflict); }",
  },
  {
    id: 17,
    role: "student",
    name: "Ariq Muldi",
    position: "Project Lead",
    title: "Engineering Standards & Review",
    image: "/ariq.jpg",
    biography:
      "Ariq Muldi is a 5th year Bachelor of Science, Honours in Computer Science, Minor in Data Science student who was the project lead for EduAI in summer of 2026. He was responsible for the team structure, delivery process, and engineering standards behind the summer build.",
    contribution:
      "Ariq led EduAI summer 2026 and built the foundation the team worked in. He set up the GitHub organization and project boards, created the Discord for fast communication between team members, and designed a review process where nothing merges without proper review and best practices. He built the system that every developer followed when it was time to do work; creating proper issues, creating descriptive pull requests, and in general, following the projects defined workflows. He also lead all the standup meetings, sprint planning meetings, meetings with professors, and meetings with the full team. This made communication between professors, 2 leads, 6 developers, and volunteers clear and kept everyone working in parallel. He was also responsible for reviewing every developers work and also acted as a senior software developer; answering any questions from the team and providing the most optimal solutions.",
    techStack: [
      "TypeScript",
      "Python",
      "React",
      "Node.js",
      "SQL",
      "Prisma",
      "Docker",
      "Google Cloud Platform",
    ],
    codeSnippet: 'if (!issue) throw new Error("no record of this work");',
  },
  {
    id: 18,
    role: "student",
    name: "Gwantana Kiboigo",
    position: "Developer",
    title: "Full-Stack Dev",
    image: "/gwan.jpg",
    biography:
      "Gwantana Kiboigo is a Junior Computer Science student at UBC with experience in software engineering, full-stack development, and building reliable software systems. Through his work on EduAI, he has gained hands-on experience across frontend, backend, database, and infrastructure development, with a particular focus on security, system reliability, and maintainable application architecture.",
    contribution:
      "Contributed to EduAI across Core, AI Tutor, and Question Maker, focusing on backend reliability, database integrity, AI service integration, and user management, while also resolving a multitude of bugs across the platform.",
    techStack: [
      "React",
      "TypeScript/JavaScript",
      "Node.js",
      "Prisma",
      "Docker",
      "Software Development",
    ],
    codeSnippet: "if (bug) { fix(); } else { sleep(); }",
  },
  {
    id: 19,
    role: "student",
    name: "Yibing Wang",
    position: "Developer",
    title: "Core Chat & Reliability",
    image: "/yibing.jpg",
    biography:
      "Yibing is a fourth year Computer Science student at UBCO with a minor in Data Science. She is interested in AI and software development, particularly LLM systems, backend development, and building practical AI applications.",
    contribution:
      "Yibing strengthened EduAI's core chat experience by building its conversation persistence and recovery flow, allowing users to return to saved conversations without losing context. She also developed the long-output handling and Continue workflow, including restoring continuation state after reloads and preventing repeated continuations. She added regression tests around these flows to improve the reliability of long-running AI conversations.",
    techStack: ["TypeScript", "React", "Node.js", "PostgreSQL", "Vitest"],
    codeSnippet: "if (stuck) { snack(); tryAgain(); }",
  },
];
