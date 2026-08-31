import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@eduai/ui";

export function AccessDeniedView() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Access restricted</CardTitle>
        <CardDescription>
          Question Maker is available to instructors, administrators, and assigned teaching
          assistants. Use EduAI Core or AI Tutor for student coursework.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Use <strong>Back to EduAI</strong> in the sidebar to return to your dashboard.
        </p>
      </CardContent>
    </Card>
  );
}
