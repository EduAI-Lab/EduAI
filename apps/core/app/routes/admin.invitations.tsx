import { useEffect, useState } from "react";
import { Link, useLoaderData, redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { IconPlus, IconDots, IconCopy, IconMailForward, IconBan } from "@tabler/icons-react";

import { auth } from "~/lib/auth/server";
import { invitableRolesFor } from "~/lib/invitations/schemas";
import { UNIT_OPTIONS } from "~/lib/units";
import {
  Button,
  Badge,
  Input,
  MultiSelect,
  Label,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  SidebarInset,
  SidebarProvider,
  PageHeading,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@eduai/ui";
import { AppSidebar } from "~/components/app-sidebar";
import { SiteHeader } from "~/components/site-header";

type InviteRole = "ADMIN" | "UNIT_ADMIN" | "INSTRUCTOR" | "STUDENT";

type Invitation = {
  id: string;
  email: string;
  name: string | null;
  // The admin create form only issues InviteRole, but the shared
  // /api/invitations list (ADMIN sees all) can include STUDENT invites a
  // unit admin created via the unitAdmins.canInvite flow.
  role: InviteRole | "STUDENT";
  authorizedUnits: string[];
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  isExpired: boolean;
};

const ROLE_OPTIONS: { value: InviteRole; label: string }[] = [
  { value: "STUDENT", label: "Student / TA" },
  { value: "INSTRUCTOR", label: "Professor (Instructor)" },
  { value: "UNIT_ADMIN", label: "Unit Administrator" },
  { value: "ADMIN", label: "Administrator" },
];

const ROLE_LABEL: Record<InviteRole | "STUDENT", string> = {
  ADMIN: "Administrator",
  UNIT_ADMIN: "Unit Admin",
  INSTRUCTOR: "Instructor",
  STUDENT: "Student",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return redirect("/auth/login");
  if (!["ADMIN", "UNIT_ADMIN"].includes(session.user.role ?? "")) return redirect("/dashboard");
  return {
    user: session.user,
    invitableRoles: invitableRolesFor(session.user.role),
  };
}

const formatDate = (s: string) =>
  new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

function StatusBadge({ invite }: { invite: Invitation }) {
  if (invite.status === "PENDING" && invite.isExpired) {
    return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Expired</Badge>;
  }
  const map: Record<Invitation["status"], string> = {
    PENDING: "bg-orange-50 text-orange-700 border-orange-200",
    ACCEPTED: "bg-green-50 text-green-700 border-green-200",
    REVOKED: "bg-gray-50 text-gray-700 border-gray-200",
  };
  return <Badge variant="outline" className={map[invite.status]}>{invite.status}</Badge>;
}

export default function InvitationsPage() {
  const { user, invitableRoles } = useLoaderData<typeof loader>();
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Invite form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<InviteRole>((invitableRoles[0] as InviteRole) ?? "INSTRUCTOR");
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Banner showing the most recent accept link (email may be console-only in dev)
  const [notice, setNotice] = useState<{ message: string; link?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Invite pending cancellation; drives the confirmation dialog.
  const [cancelTarget, setCancelTarget] = useState<Invitation | null>(null);

  const fetchInvites = async () => {
    const res = await fetch("/api/invitations");
    if (res.ok) setInvites(await res.json());
  };

  useEffect(() => {
    fetchInvites().finally(() => setLoading(false));
  }, []);

  const resetForm = () => {
    setEmail("");
    setName("");
    setRole((invitableRoles[0] as InviteRole) ?? "INSTRUCTOR");
    setSelectedUnits([]);
    setFormError(null);
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — link is still visible in the banner */
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const body: Record<string, unknown> = { email, role };
    if (name.trim()) body.name = name.trim();
    if (role === "UNIT_ADMIN") body.authorizedUnits = selectedUnits;

    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(errorMessage(data?.error, res.status, role));
        return;
      }
      setDialogOpen(false);
      resetForm();
      setNotice({
        message: data.emailDelivered
          ? `Invitation emailed to ${data.invitation.email}.`
          : `Invitation created for ${data.invitation.email} (email not configured — copy the link below).`,
        link: data.acceptUrl,
      });
      await fetchInvites();
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async (invite: Invitation) => {
    const res = await fetch(`/api/invitations/${invite.id}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ message: `Could not resend: ${errorMessage(data?.error, res.status)}` });
      return;
    }
    setNotice({
      message: data.emailDelivered
        ? `Invitation re-sent to ${invite.email}.`
        : `New link generated for ${invite.email} (email not configured — copy below).`,
      link: data.acceptUrl,
    });
    await fetchInvites();
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    const res = await fetch(`/api/invitations/${cancelTarget.id}`, { method: "DELETE" });
    if (res.ok) await fetchInvites();
    setCancelTarget(null);
  };

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar user={user} />
      <SidebarInset>
        <SiteHeader
          breadcrumbs={
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild><Link to="/dashboard">Home</Link></BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Admin</BreadcrumbPage>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Invitations</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
        />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <div className="px-4 lg:px-6">
                <div className="flex items-start justify-between gap-4">
                  <PageHeading
                    heading="Invitations"
                    subheading="Invite administrators, unit admins, instructors, and students to the platform"
                  />
                  <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
                    <IconPlus className="-ms-1 opacity-60" size={16} aria-hidden="true" />
                    Invite User
                  </Button>
                </div>
              </div>

              {notice && (
                <div className="px-4 lg:px-6">
                  <div className="rounded-md border bg-muted/40 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span>{notice.message}</span>
                      <button
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => setNotice(null)}
                        aria-label="Dismiss"
                      >
                        ✕
                      </button>
                    </div>
                    {notice.link && (
                      <div className="mt-2 flex items-center gap-2">
                        <code className="flex-1 truncate rounded bg-background px-2 py-1 text-xs">
                          {notice.link}
                        </code>
                        <Button size="sm" variant="outline" onClick={() => copyLink(notice.link!)}>
                          <IconCopy size={14} className="-ms-1" />
                          {copied ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="px-4 lg:px-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Pending & past invitations</CardTitle>
                    <CardDescription>
                      Resend to issue a fresh link, or cancel to disable a pending invite
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <p className="text-sm text-muted-foreground">Loading…</p>
                    ) : (
                      <div className="overflow-hidden rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Email</TableHead>
                              <TableHead>Role</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Invited</TableHead>
                              <TableHead>Expires</TableHead>
                              <TableHead className="w-10 text-right sr-only">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {invites.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                  No invitations yet.
                                </TableCell>
                              </TableRow>
                            ) : (
                              invites.map((invite) => (
                                <TableRow key={invite.id}>
                                  <TableCell>
                                    <div className="font-medium">{invite.email}</div>
                                    {invite.name && (
                                      <div className="text-sm text-muted-foreground">{invite.name}</div>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline">{ROLE_LABEL[invite.role] ?? invite.role}</Badge>
                                    {invite.role === "UNIT_ADMIN" && invite.authorizedUnits.length > 0 && (
                                      <div className="mt-1 text-xs text-muted-foreground">
                                        {invite.authorizedUnits.join(", ")}
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell><StatusBadge invite={invite} /></TableCell>
                                  <TableCell className="text-sm">{formatDate(invite.createdAt)}</TableCell>
                                  <TableCell className="text-sm">{formatDate(invite.expiresAt)}</TableCell>
                                  <TableCell className="text-right">
                                    {invite.status === "PENDING" && (
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Open menu">
                                            <IconDots className="h-4 w-4" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          <DropdownMenuItem onClick={() => handleResend(invite)}>
                                            <IconMailForward className="mr-2 h-4 w-4" />
                                            Resend / copy link
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={() => setCancelTarget(invite)}
                                            className="text-destructive focus:text-destructive"
                                          >
                                            <IconBan className="mr-2 h-4 w-4" />
                                            Cancel invitation
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>

        {/* Invite dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Invite a user</DialogTitle>
              <DialogDescription>
                They'll receive a link to set a password and activate their account.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="person@university.edu"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-name">Name (optional)</Label>
                <Input
                  id="invite-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as InviteRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.filter((o) => invitableRoles.includes(o.value)).map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {role === "STUDENT" && (
                  <p className="text-xs text-muted-foreground">
                    Students can be promoted to TA inside a course — a TA is a
                    student with extra course access. There is no separate TA
                    invite.
                  </p>
                )}
              </div>
              {role === "UNIT_ADMIN" && (
                <div className="space-y-2">
                  <Label htmlFor="invite-units">Authorized units</Label>
                  <MultiSelect
                    options={UNIT_OPTIONS.map((dept) => ({
                      value: dept.code,
                      label: dept.label,
                      description: dept.code,
                    }))}
                    value={selectedUnits}
                    onValueChange={setSelectedUnits}
                    placeholder="Select units"
                    searchPlaceholder="Search units..."
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for a unit administrator — they manage only these subject units.
                  </p>
                </div>
              )}
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Sending…" : "Send invite"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Cancel confirmation */}
        <AlertDialog
          open={!!cancelTarget}
          onOpenChange={(open) => { if (!open) setCancelTarget(null); }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this invitation?</AlertDialogTitle>
              <AlertDialogDescription>
                The invitation for {cancelTarget?.email} will be cancelled and its link
                will stop working. This cannot be undone — you can send a fresh invite later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep invitation</AlertDialogCancel>
              <AlertDialogAction onClick={confirmCancel}>Cancel invitation</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SidebarInset>
    </SidebarProvider>
  );
}

function errorMessage(code: unknown, status: number, role?: string): string {
  switch (code) {
    case "USER_EXISTS":
      return "A user with that email already exists.";
    case "Invalid input":
      return role === "UNIT_ADMIN"
        ? "Please check the fields and try again — a unit admin invitation must include at least one unit."
        : "Please check the fields and try again.";
    case "NOT_PENDING":
      return "This invitation is no longer pending.";
    case "NOT_FOUND":
      return "Invitation not found.";
    default:
      return typeof code === "string" && code ? code : `Request failed (${status}).`;
  }
}
