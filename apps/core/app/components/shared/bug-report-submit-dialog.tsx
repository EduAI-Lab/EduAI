import { useState } from "react";
import { IconBug } from "@tabler/icons-react";

import { Button } from "@eduai/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@eduai/ui";
import { Input } from "@eduai/ui";
import { Label } from "@eduai/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@eduai/ui";
import { Textarea } from "@eduai/ui";
import { Switch } from "@eduai/ui";
import type { BugReportType } from "~/hooks/api/types";
import { useSubmitBugReport } from "~/hooks/api/use-submit-bug-report";

const BUG_TYPE_OPTIONS: { value: BugReportType; label: string }[] = [
  { value: "UI_DISPLAY", label: "UI / display issue" },
  { value: "FEATURE_NOT_WORKING", label: "Feature not working" },
  { value: "PERFORMANCE", label: "Performance issue" },
  { value: "CONTENT_ERROR", label: "Content error" },
  { value: "ACCESS_PERMISSION", label: "Access / permission issue" },
  { value: "OTHER", label: "Other" },
];

type BugReportSubmitDialogProps = {
  triggerClassName?: string;
};

export function BugReportSubmitDialog({
  triggerClassName,
}: BugReportSubmitDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [bugType, setBugType] = useState<BugReportType | null>(null);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { submitBugReport, isSubmitting, isStubbed } = useSubmitBugReport();

  const handleSubmit = async () => {
    // Fold the optional title into the description before sending — the DB schema
    // has no separate title column (removed in #304).
    const mergedDescription = title.trim()
      ? `${title.trim()}\n\n${description.trim()}`
      : description.trim();
    const ok = await submitBugReport({ description: mergedDescription, bugType, isAnonymous });
    if (ok) {
      setSubmitted(true);
      setTitle("");
      setDescription("");
      setBugType(null);
      setIsAnonymous(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSubmitted(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={triggerClassName}>
          <IconBug className="h-4 w-4 mr-1" />
          Report bug
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Submit bug report</DialogTitle>
          <DialogDescription>
            Describe the issue you encountered. All roles can submit reports
            (§11).
            {isStubbed && " Using stub API until Core #304 lands."}
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <p className="text-sm text-muted-foreground">
            Thank you — your report was recorded.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bug-title">Title</Label>
              <Input
                id="bug-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Brief summary"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bug-type">Bug type</Label>
              <Select
                value={bugType ?? ""}
                onValueChange={(value) => setBugType(value as BugReportType)}
              >
                <SelectTrigger id="bug-type">
                  <SelectValue placeholder="Select a type" />
                </SelectTrigger>
                <SelectContent>
                  {BUG_TYPE_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bug-description">Description</Label>
              <Textarea
                id="bug-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Steps to reproduce, expected vs actual behavior"
                rows={4}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="bug-anonymous">Submit anonymously</Label>
                <p className="text-xs text-muted-foreground">
                  Your name is hidden in admin triage views.
                </p>
              </div>
              <Switch
                id="bug-anonymous"
                checked={isAnonymous}
                onCheckedChange={setIsAnonymous}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
          {!submitted && (
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !title.trim() || !description.trim() || !bugType}
            >
              Submit
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
