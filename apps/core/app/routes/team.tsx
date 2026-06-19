import { Link } from "react-router";
import { AnimatedBackground } from "~/components/animated-background";
import { SiteHeader } from "~/components/site-header";
import { SiteNavigation } from "~/components/site-navigation";
import { SiteFooter } from "~/components/site-footer";
import { TeamMemberCard } from "~/components/team-member-card";

export interface TeamMember {
  id: number;
  name: string;
  image: string;
  biography: string;
  contribution: string;
  techStack: string[];
  codeSnippet: string;
}

export const teamMembers: TeamMember[] = [
  {
    id: 1,
    name: "Dr. Abdallah Mohamed",
    image: "/AbdullahMoh.jpeg",
    biography: "Professor Abdallah Mohamed’s expertise spans software engineering, decision support systems, and creative higher education. His research integrates optimization techniques, expert systems, and component-based software development to enhance decision-making in complex, uncertain, and dynamic environments. Beyond technical research, he is committed to advancing innovation in teaching and learning, developing new methodologies to foster creativity, engagement, and personalized learning experiences.",
    contribution:"Directs AI research, managing model selection and experiments with students to optimize LLM and RAG performance for EduAI.",
    techStack: ["Machine Learning", "Deep Learning", "RAG", "LLMs", "Parallel Computing" ],
    codeSnippet: "Awarded 2023 IKBFOS Grant for innovative courseware advancing computer programming education.",
  },
  {
    id: 2,
    name: "Dr. Mostafa Mohamed",
    image: "/MohMustafa.jpeg",
    biography:" Professor Mostafa Mohamed, previously an Assistant Professor of Biomedical Engineering and now a Computer Science professor at UBCO , advances research in AI, machine learning, and medical imaging. His notable contributions include white blood cell segmentation, leukemia detection, deep learning–based scene analysis, and human cell classification. With 500+ citations and more than a dozen publications at IEEE, he integrates hardware acceleration, parallel computing, and cloud systems to enhance healthcare diagnostics.",
    contribution:"Leads backend development and guides students in building scalable AI infrastructure using LLMs and RAG pipelines for EduAI.",
    techStack: ["Big Data", "GPU acceleration", "Cloud Computing", "Medical Image Processing"],
    codeSnippet: "500+ citations pioneering AI medical image analysis, leukemia detection, and published at IEEE.",


  },
  {
    id: 3,
    name: "Dr. Fatemeh Fard",
    image: "/Fatemah.jpeg",
    biography: "Assistant Professor in Computer Science and Data Science at UBC Okanagan, leading the FARD Lab (Foundational AIware Research and Development). Her research focuses on AI-driven software engineering, large language models for code, and NLP applications in low-resource programming languages.",
    contribution: "Leads research on adapter-based fine-tuning for low-resource programming languages, exploring transfer learning techniques to improve code intelligence. She has published extensively on code summarization, code clone detection, and the intersection of AI and software development.",
    techStack: ["Python", "PyTorch", "Transformers", "HuggingFace", "NLP", "LLMs", "Data Visualization"],
    codeSnippet: "from transformers import AutoModel, AutoTokenizer; model = AutoModel.from_pretrained('microsoft/codebert-base'); tokenizer = AutoTokenizer.from_pretrained('microsoft/codebert-base'); inputs = tokenizer('def example(): return True', return_tensors='pt'); outputs = model(**inputs)",
  },
  {
    id: 4,
    name: "Dr. Ramon Lawrence",
    image: "/Ramon_Law.jpeg",
    biography: "Professor and Department Head of Computer Science and Data Science at UBC Okanagan. His research spans database systems, data integration, and sensor/IoT data management. He is also the founder of Unity Data Inc., the developer of UnityJDBC—a system that enables SQL queries across heterogeneous data sources.",
    contribution: "Directed the Distributed Database Lab, advanced query optimization algorithms, and developed the UnityJDBC driver integrating relational and NoSQL data. His work bridges academic research and industry by providing scalable database solutions and mentoring numerous software engineering students.",
    techStack: [ "PostgreSQL", "MySQL", "MongoDB", "Java", "JDBC", "C/C++", "SQL Optimization"],
    codeSnippet: "try (Connection conn = DriverManager.getConnection(url, user, pass)) { Statement stmt = conn.createStatement(); ResultSet rs = stmt.executeQuery('SELECT * FROM students'); while (rs.next()) { System.out.println(rs.getString('name')); } }"
  },
  {
    id: 5,
    name: "Ronit Buti ",
    image: "/ronit.jpg",
    biography: "Ronit is an Honors Computer Science student who built EduAI, including a provider-agnostic model registry and a pgvector-backed retrieval layer that grounds answers in uploaded course materials.",
    contribution: "Led full-stack development of the platform including auth, UI, backend, and RAG pipeline, while architecting extensible tool interfaces for web search and document retrieval." ,
    techStack: ["React", "TypeScript", "Next.js", "Prisma", "AI SDK"],
    codeSnippet: "generateText({ model: 'openai/gpt-5.2', prompt: 'You are a helpful assistant.' })"
  },
 {
    id: 6,
    name: "Stavan Shah",
    image: "/Stavan.jpeg",
    biography: "Stavan is an Honours Computer Science student specializing in AI-driven software engineering and RAG systems.He previously worked on Courseplanner which is a course advising chatbot for UBC and an automated configuration agent. His current research focuses on 'Supervisory AI' architectures, designing multi-agent systems where a secondary model validates pedagogical feedback to ensure accuracy and educational value.",
    contribution: "Manages the backend API and database architecture. He ensures that all server-side operations are secure, scalable, and properly integrated with the application's data models.",
    techStack: ["React", "TypeScript", "Go", "Django", "Angular", "PostgreSQL"],
    codeSnippet: "rm -rf node_modules && npm install && pray"
  },
  {
    id: 7,
    name: "Ahab Masud Siddiqui",
    image: "/AA.JPG",
    biography: "As a sophomore in Computer Science at UBC and a software engineering intern , I've accumulated strong skills in software development. I have experience in building full-stack web applications and AI/ML projects. I've worked under the supervision of multiple professors in developing an mobile application for a Hospital Wayfinding App as well using Swift and Flutter. I'm eager to contribute to EduAI and collaborate with a passionate research team.",
    contribution: "Frontend development and AI integrations for EduAI.",
    techStack: ["React Native & RR7 ", "Node.js", "TensorFlow", "Docker", "Vite+TypeScript" , "Next.js"],
    codeSnippet: "Software Engineering Intern, Directed Studies presenter, Top 5 finalist in UBC Hackathon.",
  },
  {
    id: 8,
    name: "Necmi Kaan Sapoglu",
    image: "/kaan.png",
    biography:"An undergraduate from Turkey with a great interest for AI used in education, as well as a personal interest in video game development. In the EduAI project, he helps develop the backend infrastructure, developing the database, and handling API calls.",
    contribution: "Developed backend infrastructure, managed databases, and implemented API integrations, while exploring applications of AI in education and maintaining a strong personal interest in video game development.",
    techStack: ["Backend Architecture", "Software Development", "APIs", "ReactRouter"],
    codeSnippet: " if (working == true){take a break; }else { take a break;}",
  },
  {
    id: 9,
    name: "Ribhav Sharma",
    image: "/rib.jpeg",
    biography: "Ribhav Sharma is a 4th-year Computer Science student who has demonstrated a strong aptitude for AI and software development. He contributed to the EduAI project, focusing on enhancing the platform’s learning capabilities and user-interaction framework. Ribhav brings a blend of academic rigor and hands-on development experience, making him an asset in building innovative tech solutions.",
    contribution: "Contributed to EduAI: improved core learning algorithms and enhanced user-interaction systems.",
    techStack: ["Java", "Python", "machine learning", "React", "Node.js"],
    codeSnippet: "while( internship_game == up ) {chills} "
  },
  {
    id: 10,
    name: "Leila Saparbek",
    image: "/Leila.jpg",
    biography: "Fourth-year Computer Science and Data Science student at UBC Okanagan. Interested in backend development, data pipelines, and applying machine learning to solve real-world problems.",
    contribution: "Volunteer Research Assistant contributing to backend infrastructure development and data architecture design. Responsible for implementing API endpoints and database integration, with a focus on designing efficient data pipelines that ensure seamless information flow throughout the system using React Router 7 and PostgreSQL." ,
    techStack: ["Python","SQL", "Node.js", "APIs", "React Router 7", "PostgreSQL"],
    codeSnippet: " while self.at(UBC): self.study() self.code() self.drink(RedBull) "
  },
  {
    id: 11,
    name: "Mohamed Gamal Sakr",
    image: "/sakr.jpg",
    biography: "Mohamed Gamal Sakr is an honours Computer Science student at UBC Okanagan specializing in agentic AI and machine learning. He has industry experience from a software engineering internship at Allianz and currently develops LLM-based code vulnerability tools at UBCO. As a student leader and former president-elect of the Computer Science Course Union, he has earned the Dean’s List (2025) and UBC’s Outstanding International Student Award (2022). His project excellence was recognized with the Database Web Development Badge (2024). He also holds professional certifications from Stanford and Harvard, focusing on applying advanced AI research to practical, real-world systems. ",
    contribution: "Lead AI Engineer & Project Manager who integrated a Retrieval-Augmented Generation (RAG) engine and production-grade vector database into the core platform while also directing the project lifecycle — from planning and technical design to task management and team coordination — ensuring timely delivery and alignment between engineering, research, and product stakeholders." ,
    techStack: ["Machine Learning" , "Agentic AI" , "LLMs"],
    codeSnippet: "if (hardwork) then dubs"
  }


];

export default function TeamPage() {
  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <AnimatedBackground />
      <SiteNavigation currentPage="team" />

      {/* Main Content */}
      <main className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Project Introduction */}
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-foreground mb-4">Meet our research team</h2>
          <div className="w-24 h-1 bg-gradient-to-r from-green-400 to-blue-500 mx-auto rounded mb-6"></div>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            Our dedicated team of undergraduate and graduate students is working alongside faculty to advance the field
            of Educational Artificial Intelligence, creating innovative solutions that enhance learning experiences for
            students worldwide.
          </p>
          <div className="mt-4 text-green-400 font-mono text-sm opacity-70">
            {"// Building the future of education with code and AI"}
          </div>
        </div>

        {/* Team Members */}
        <div className="space-y-12">
          {teamMembers.map((member, index) => (
            <TeamMemberCard key={member.id} member={member} index={index} />
          ))}
        </div>

        <SiteFooter />
      </main>
    </div>
  );
}
