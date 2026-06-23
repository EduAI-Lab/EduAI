import { IconBrain, IconTarget, IconCode, IconCpu, IconUsers, IconBulb, IconGitBranch, IconWorld } from "@tabler/icons-react";
import { Card, CardContent } from "@eduai/ui";

const goals = [
  {
    icon: IconBrain,
    title: "Cognitive AI Models",
    description:
      "Develop state-of-the-art AI models that understand and adapt to individual learning patterns.",
  },
  {
    icon: IconTarget,
    title: "Personalized Learning",
    description:
      "Create adaptive learning paths that evolve with each student's progress and needs.",
  },
  {
    icon: IconCode,
    title: "Open Source",
    description:
      "Contribute to the educational community through open-source AI tools and frameworks.",
  },
  {
    icon: IconCpu,
    title: "Advanced Analytics",
    description:
      "Provide deep insights into learning patterns and educational effectiveness.",
  },
  {
    icon: IconUsers,
    title: "Collaborative Learning",
    description:
      "Foster peer-to-peer learning through AI-facilitated group interactions.",
  },
  {
    icon: IconWorld,
    title: "Global Access",
    description:
      "Make quality education accessible to learners worldwide through AI technology.",
  },
  {
    icon: IconBulb,
    title: "Innovation",
    description:
      "Push the boundaries of educational technology with cutting-edge AI research.",
  },
  {
    icon: IconGitBranch,
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
          <h2 className="text-4xl font-bold text-foreground mb-4">Project goals</h2>
          <div className="w-24 h-1 bg-gradient-to-r from-green-400 to-blue-500 mx-auto rounded"></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {goals.map((goal, index) => (
            <Card
              key={index}
              className="bg-card/50 backdrop-blur-sm border border-border hover:border-accent transition-colors"
            >
              <CardContent className="p-6">
                <div className="h-12 w-12 rounded-lg bg-gradient-to-r from-green-400/20 to-blue-500/20 flex items-center justify-center mb-4">
                  <goal.icon className="h-6 w-6 text-green-400" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {goal.title}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
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
