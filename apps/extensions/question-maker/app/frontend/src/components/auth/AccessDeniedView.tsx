import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@eduai/ui';


export function AccessDeniedView() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Access restricted</CardTitle>
        <CardDescription>
          Question Maker is available to instructors and administrators. Students and teaching
          assistants should use EduAI Core or AI Tutor instead.
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
