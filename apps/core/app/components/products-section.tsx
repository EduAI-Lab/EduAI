import { useState } from "react";
import {
  IconMessages,
  IconSparkles,
  IconClipboardText,
  IconChevronDown,
  IconPlugConnected,
  IconCheck,
} from "@tabler/icons-react";
import {
  Badge,
  Card,
  CardContent,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  PageHeading,
} from "@eduai/ui";
import type { Icon } from "@tabler/icons-react";

interface Product {
  icon: Icon;
  name: string;
  kind: "platform" | "extension";
  tagline: string;
  description: string;
  /** Longer blurb revealed when the card is expanded. */
  details: string;
  /** Bulleted highlights revealed when the card is expanded. */
  features: string[];
  /** Extensions only: how the tool plugs into Core. */
  connection?: string;
}

/**
 * The tools the lab ships, framed around the platform's shape: EduAI Core is the
 * hub, and everything else is an "extension" that plugs into it. Sits between the
 * "About" and "Goals" sections of the single-scroll landing page. Each card
 * expands (Radix Collapsible, so the trigger carries the aria state) to reveal a
 * longer write-up, feature highlights, and — for extensions — the line back to
 * Core. Styling mirrors the Project goals grid and reads from shared tokens so it
 * follows the theme toggle.
 */
const core: Product = {
  icon: IconMessages,
  name: "EduAI Core",
  kind: "platform",
  tagline: "The platform everything runs on",
  description:
    "Our home-grown tutoring platform, and the hub every other tool plugs into. It connects to your course slides, readings, and syllabi, then answers questions grounded in what your professor actually taught — not random guesses from the open web.",
  details:
    "Core owns the parts every tool needs: accounts and sign-in, courses and enrollment, the uploaded course materials, and the retrieval layer that grounds answers in them. Build an extension on top and it inherits all of that for free — one account, one design system, and one grounded model layer shared across the whole platform.",
  features: [
    "Retrieval-augmented chat grounded in your course slides, readings, and syllabi",
    "Courses and enrollment for students, TAs, and instructors",
    "One account and one design system shared across every tool",
    "A provider-agnostic model registry, so the underlying AI can be swapped without touching the apps",
    "The auth and data backbone every extension reads through",
  ],
};

const extensions: Product[] = [
  {
    icon: IconSparkles,
    name: "AI Tutor",
    kind: "extension",
    tagline: "Guided, step-by-step lessons",
    description:
      "Interactive lessons and practice activities that walk you through tricky topics one step at a time. Instead of handing over the answer, it nudges you toward it and adapts to where you are in your coursework.",
    details:
      "Instructors and TAs author lessons and activities per unit; students work through them at their own pace with feedback along the way. Because it runs on Core, it already knows the course roster and can ground its explanations in the same uploaded materials the Core tutor uses.",
    features: [
      "Interactive lessons and practice activities, one step at a time",
      "Adapts to where you are in the course",
      "Authoring and grading tools for instructors and TAs",
      "Reads course materials and enrollment straight from Core",
    ],
    connection: "Plugs into Core for sign-in, course data, and the grounded model layer.",
  },
  {
    icon: IconClipboardText,
    name: "Question Maker",
    kind: "extension",
    tagline: "Assessments, made lighter",
    description:
      "A tool built for instructors. It helps professors spin up fresh variations of assessment questions for their courses, cutting the busywork of writing practice sets and exams by hand.",
    details:
      "Generate new takes on a question, collect them into reusable banks per course, and pull it all together into an assessment. It leans on Core for course context and model access, so the questions it drafts stay tied to the material a class is actually covering.",
    features: [
      "Generate fresh variations of assessment questions",
      "Build and reuse question banks per course",
      "Cuts the manual work of writing practice sets and exams",
      "Uses Core's course data and model access",
    ],
    connection: "Plugs into Core for sign-in, course data, and the grounded model layer.",
  },
];

function FeatureList({ features }: { features: string[] }) {
  return (
    <ul className="space-y-2">
      {features.map((feature) => (
        <li key={feature} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-text" />
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}

function ProductCard({ product, featured = false }: { product: Product; featured?: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = product.icon;

  return (
    <Card
      className={`border bg-background transition-colors ${
        featured ? "border-primary/40" : "border-border hover:border-primary/50"
      }`}
    >
      <CardContent className="p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-6 w-6 text-primary-text" />
          </div>
          <Badge variant={featured ? "secondary" : "outline"}>
            {product.kind === "platform" ? "Core platform" : "Extension"}
          </Badge>
        </div>

        <h3 className="text-lg font-semibold text-foreground">{product.name}</h3>
        <p className="mb-2 text-sm font-medium text-primary-text">{product.tagline}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{product.description}</p>

        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
            <div className="mt-5 space-y-5 border-t border-border pt-5">
              <p className="text-sm leading-relaxed text-muted-foreground">{product.details}</p>

              <div>
                <h4 className="mb-2 text-sm font-medium text-foreground">Highlights</h4>
                <FeatureList features={product.features} />
              </div>

              {product.connection ? (
                <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border bg-muted px-3 py-2">
                  <IconPlugConnected className="mt-0.5 h-4 w-4 shrink-0 text-primary-text" />
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {product.connection}
                  </p>
                </div>
              ) : null}
            </div>
          </CollapsibleContent>

          <CollapsibleTrigger className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary-text transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {open ? "Show less" : "Learn more"}
            <IconChevronDown
              className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

export function ProductsSection() {
  return (
    <section id="products" className="scroll-mt-20 border-t border-border bg-card py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <PageHeading
          heading="What we build"
          className="mb-12 text-center [&>div]:mx-auto"
          headingClassName="text-3xl lg:text-4xl font-bold text-foreground"
          subheading={
            <span className="mx-auto block max-w-3xl text-lg">
              EduAI is one platform, not a pile of separate apps. Core does the heavy lifting, and
              everything else is an extension that plugs straight into it — so every tool shares the
              same account, course data, and grounded AI.
            </span>
          }
        />

        <div className="space-y-8">
          <ProductCard product={core} featured />

          <div className="flex items-center gap-3">
            <IconPlugConnected className="h-5 w-5 shrink-0 text-primary-text" />
            <span className="text-sm font-medium text-foreground">
              Extensions — each one connects back to Core
            </span>
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            {extensions.map((product) => (
              <ProductCard key={product.name} product={product} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
