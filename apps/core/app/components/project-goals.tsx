import { Brain, Target, Code, Cpu, Users, Lightbulb, GitBranch, Globe } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";

const goals = [
  {
    icon: Brain,
    title: "Cognitive AI Models",
    description:
      "Develop state-of-the-art AI models that understand and adapt to individual learning patterns.",
  },
  {
    icon: Target,
    title: "Personalized Learning",
    description:
      "Create adaptive learning paths that evolve with each student's progress and needs.",
  },
  {
    icon: Code,
    title: "Open Source",
    description:
      "Contribute to the educational community through open-source AI tools and frameworks.",
  },
  {
    icon: Cpu,
    title: "Advanced Analytics",
    description:
      "Provide deep insights into learning patterns and educational effectiveness.",
  },
  {
    icon: Users,
    title: "Collaborative Learning",
    description:
      "Foster peer-to-peer learning through AI-facilitated group interactions.",
  },
  {
    icon: Globe,
    title: "Global Access",
    description:
      "Make quality education accessible to learners worldwide through AI technology.",
  },
  {
    icon: Lightbulb,
    title: "Innovation",
    description:
      "Push the boundaries of educational technology with cutting-edge AI research.",
  },
  {
    icon: GitBranch,
    title: "Integration",
    description:
      "Seamlessly integrate with existing educational platforms and workflows.",
  },
];

export function ProjectGoals() {
  return (
    <section className="relative py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-white mb-4">Project Goals</h2>
          <div className="w-24 h-1 bg-gradient-to-r from-green-400 to-blue-500 mx-auto rounded"></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {goals.map((goal, index) => (
            <Card
              key={index}
              className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 hover:border-slate-600 transition-colors"
            >
              <CardContent className="p-6">
                <div className="h-12 w-12 rounded-lg bg-gradient-to-r from-green-400/20 to-blue-500/20 flex items-center justify-center mb-4">
                  <goal.icon className="h-6 w-6 text-green-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  {goal.title}
                </h3>
                <p className="text-slate-300 text-sm leading-relaxed">
                  {goal.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
