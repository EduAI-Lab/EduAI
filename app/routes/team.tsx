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
    name: "Dr. Abdullah Mohammed",
    image: "/AbdullahMoh.jpeg",
    biography: "Professor Abdallah Mohamed’s expertise spans software engineering, decision support systems, and creative higher education. His research integrates optimization techniques, expert systems, and component-based software development to enhance decision-making in complex, uncertain, and dynamic environments. Beyond technical research, he is committed to advancing innovation in teaching and learning, developing new methodologies to foster creativity, engagement, and personalized learning experiences.",
    contribution:"Directs AI research, managing model selection and experiments with students to optimize LLM and RAG performance for EduAI.",
    techStack: ["Machine Learning", "Deep Learning", "RAG", "LLMs", "Parallel Computing" ],
    codeSnippet: "Awarded 2023 IKBFOS Grant for innovative courseware advancing computer programming education.",
  },
  {
    id: 2,
    name: "Dr. Mohammad Mostafa",
    image: "/MohMustafa.jpeg",
    biography:" Professor Mostafa Mohamed, previously an Assistant Professor of Biomedical Engineering and now a Computer Science professor at UBCO , advances research in AI, machine learning, and medical imaging. His notable contributions include white blood cell segmentation, leukemia detection, deep learning–based scene analysis, and human cell classification. With 500+ citations and more than a dozen publications at IEEE, he integrates hardware acceleration, parallel computing, and cloud systems to enhance healthcare diagnostics.",
    contribution:"Leads backend development and guides students in building scalable AI infrastructure using LLMs and RAG pipelines for EduAI.",
    techStack: ["Big Data", "GPU acceleration", "Cloud Computing", "Medical Image Processing"],
    codeSnippet: "500+ citations pioneering AI medical image analysis, leukemia detection, and published at IEEE.",


  },
  {
    id: 3,
    name: "Ahab Masud Siddiqui",
    image: "/AA.JPG",
    biography:
      "As a sophomore in Computer Science at UBC and a software engineering intern , I've accumulated strong skills in software development. I have experience in building full-stack web applications and AI/ML projects. I've worked under the supervision of multiple professors in developing an mobile application for a Hospital Wayfinding App aswell using Swift and Flutter. I'm eager to contribute to EduAI and collaborate with a passionate research team.",
    contribution: "Frontend development and AI integrations for EduAI.",
    techStack: ["React Native & RR7 ", "Node.js", "TensorFlow", "Docker", "Vite+TypeScript" , "Next.js"],
    codeSnippet: "Software Engineering Intern, Directed Studies presenter, Top 5 finalist in UBC Hackathon.",

  },
  {
    id: 4,
    name: "Necmi Kaan Sapoglu",
    image: "/kaan.png",
    biography:
      "An undergraduate from Turkey with a great interest for AI used in education, as well as a personal interest in video game development. In the EduAI project, he helps develop the backend infrastructure, developing the database, and handling API calls.",
    contribution:
      "Developed backend infrastructure, managed databases, and implemented API integrations, while exploring applications of AI in education and maintaining a strong personal interest in video game development.",
    techStack: ["Backend Architecture", "Software Development", "APIs", "ReactRouter"],
    codeSnippet: " if (working == true){take a break; }else { take a break;}",
  }


];

export default function TeamPage() {
  return (
    <div className="min-h-screen bg-slate-900 relative overflow-hidden">
      <AnimatedBackground />
      <SiteNavigation currentPage="team" />

      {/* Main Content */}
      <main className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Project Introduction */}
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-white mb-4">Meet Our Research Team</h2>
          <div className="w-24 h-1 bg-gradient-to-r from-green-400 to-blue-500 mx-auto rounded mb-6"></div>
          <p className="text-xl text-slate-300 max-w-3xl mx-auto">
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