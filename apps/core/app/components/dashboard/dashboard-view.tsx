import { Link } from "react-router";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export type DashboardAction = {
  title: string;
  description: string;
  href: string;
};

export type DashboardViewProps = {
  heading: string;
  subheading: string;
  actions: DashboardAction[];
};

export function DashboardView({ heading, subheading, actions }: DashboardViewProps) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="px-4 lg:px-6">
            <h2 className="text-2xl font-bold">{heading}</h2>
            <p className="text-muted-foreground">{subheading}</p>
          </div>

          <div className="grid gap-4 px-4 lg:px-6 md:grid-cols-2 xl:grid-cols-3">
            {actions.map((action) => (
              <Link key={action.href + action.title} to={action.href} className="block">
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardHeader>
                    <CardTitle className="text-lg">{action.title}</CardTitle>
                    <CardDescription>{action.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <span className="text-sm font-medium text-primary">Open →</span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
