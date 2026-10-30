/**
 * #2002, #2061: the course Settings tab's "What students see" — the one place an
 * instructor shows or hides the course's files: all at once, by topic, or one
 * file at a time, plus whether students may browse the files. Each change saves
 * as it is made. A hidden topic hides its files and wins over a shown one;
 * Canvas can hide a file too. Bulk reveals and hiding everything ask first.
 *
 * `fetch` is a small in-memory server: a PATCH changes its state the way the
 * real route does, and the next GET reads it back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import {
  CourseStudentVisibilitySettings,
  describeFileVisibility,
  revealDescription,
} from "~/components/courses/course-student-visibility-settings";

type FileRow = {
  id: string;
  title: string;
  visibleToStudents: boolean;
  availableAt: string | null;
  topicIds: string[];
  hiddenByCanvas: boolean;
};
type TopicRow = { id: string; name: string; visibleToStudents: boolean };
type ServerState = { studentFilesVisible: boolean; topics: TopicRow[]; files: FileRow[] };
type Change = { id: string; visibleToStudents: boolean };
type PatchBody = {
  studentFilesVisible?: boolean;
  topics?: Change[];
  materials?: Change[];
  fileGroup?: { scope: "all" | "unfiled" | "topic"; topicId?: string; visibleToStudents: boolean };
  availableAt?: string | null;
};

const file = (id: string, topicIds: string[], extra: Partial<FileRow> = {}): FileRow => ({
  id,
  title: `File ${id}`,
  visibleToStudents: true,
  availableAt: null,
  topicIds,
  hiddenByCanvas: false,
  ...extra,
});

let server: ServerState;
const patches: { url: string; body: PatchBody }[] = [];
const onSaved = vi.fn();
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (!init || init.method === undefined) return Response.json(structuredClone(server));
  const body = JSON.parse(init.body as string) as PatchBody;
  patches.push({ url, body });
  if (body.studentFilesVisible !== undefined) server.studentFilesVisible = body.studentFilesVisible;
  for (const t of body.topics ?? []) {
    server.topics.find((row) => row.id === t.id)!.visibleToStudents = t.visibleToStudents;
  }
  for (const m of body.materials ?? []) {
    server.files.find((row) => row.id === m.id)!.visibleToStudents = m.visibleToStudents;
  }
  const group = body.fileGroup;
  if (group) {
    for (const f of server.files) {
      const inGroup =
        group.scope === "all" ||
        (group.scope === "unfiled" && f.topicIds.length === 0) ||
        (group.scope === "topic" && f.topicIds.includes(group.topicId!));
      if (inGroup) f.visibleToStudents = group.visibleToStudents;
    }
    if (group.scope === "all") {
      for (const t of server.topics) t.visibleToStudents = group.visibleToStudents;
    }
  }
  if (body.availableAt !== undefined) {
    const id = url.split("/").pop();
    server.files.find((row) => row.id === id)!.availableAt = body.availableAt;
  }
  return Response.json({ success: true });
});

function renderSettings(saved: (() => void) | undefined = onSaved) {
  render(
    <MemoryRouter>
      <CourseStudentVisibilitySettings courseId="c1" onSaved={saved} />
    </MemoryRouter>,
  );
  return screen.findByRole("checkbox", { name: "Show course materials to students" });
}

function openTopics() {
  fireEvent.click(screen.getByRole("button", { name: "Choose by topic" }));
}

function openFiles(group: string) {
  fireEvent.click(screen.getByRole("button", { name: `Show the files in ${group}` }));
}

function stateOf(name: string) {
  return screen.getByRole("checkbox", { name }).getAttribute("data-state");
}

beforeEach(() => {
  vi.clearAllMocks();
  patches.length = 0;
  server = {
    studentFilesVisible: false,
    topics: [
      { id: "t1", name: "Sorting", visibleToStudents: true },
      { id: "t2", name: "Exam prep", visibleToStudents: true },
    ],
    files: [file("m1", ["t1"]), file("m2", ["t1", "t2"]), file("m3", ["t2"]), file("m4", [])],
  };
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CourseStudentVisibilitySettings (#2002, #2061)", () => {
  it("starts with one switch for every file and keeps the topics folded away", async () => {
    const all = await renderSettings();

    expect(all).toHaveAttribute("data-state", "checked");
    expect(screen.getByText("All 4 files are shown to students.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose by topic" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("checkbox", { name: "Sorting" })).toBeNull();
    expect(screen.getByRole("switch", { name: "Let students browse files" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("asks before hiding everything, then hides it on the server in one change", async () => {
    fireEvent.click(await renderSettings());

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Hide all materials from students?");
    expect(patches).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Hide all materials" }));

    await waitFor(() => expect(stateOf("Show course materials to students")).toBe("unchecked"));
    // A group, not a list of ids: the server covers files added since the page loaded.
    expect(patches[0].body).toEqual({ fileGroup: { scope: "all", visibleToStudents: false } });
    expect(screen.getByText(/All 4 files are hidden from students\./)).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalled();
  });

  it("changes nothing when the confirmation is cancelled", async () => {
    fireEvent.click(await renderSettings());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(patches).toEqual([]);
  });

  it("names how many hidden files showing everything would reveal", async () => {
    server.files[0].visibleToStudents = false;
    server.files[2].visibleToStudents = false;
    server.files[2].availableAt = "2099-01-01T00:00:00.000Z";
    const all = await renderSettings();

    expect(all).toHaveAttribute("data-state", "indeterminate");
    fireEvent.click(all);

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("2 hidden files will be shown to students");
    // The hidden file with a future date is the one being revealed, so the note shows.
    expect(dialog).toHaveTextContent("Files scheduled for a later date still wait");
    fireEvent.click(within(dialog).getByRole("button", { name: "Show files" }));
    await waitFor(() => expect(all).toHaveAttribute("data-state", "checked"));
    expect(patches[0].body).toEqual({ fileGroup: { scope: "all", visibleToStudents: true } });
  });

  it("hides a topic by its own switch, and a file under it stays hidden under a shown topic", async () => {
    await renderSettings();
    openTopics();
    fireEvent.click(screen.getByRole("checkbox", { name: "Exam prep" }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].body).toEqual({ topics: [{ id: "t2", visibleToStudents: false }] });
    await waitFor(() => expect(stateOf("Exam prep")).toBe("unchecked"));
    // m2 is under Sorting too, but the hidden topic wins.
    expect(screen.getByText("2 files, 1 hidden")).toBeInTheDocument();
    openFiles("Sorting");
    expect(screen.getByText("Hidden with “Exam prep”")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "File m2" })).toBeDisabled();
    expect(
      screen.getByText(
        /2 of 4 files are shown to students, and 2 are hidden\. 1 topic is hidden\./,
      ),
    ).toBeInTheDocument();
  });

  it("asks before showing a topic's hidden files, and leaves ones another topic hides", async () => {
    server.topics[1].visibleToStudents = false;
    server.files[0].visibleToStudents = false;
    server.files[1].visibleToStudents = false;
    await renderSettings();
    openTopics();

    expect(stateOf("Sorting")).toBe("indeterminate");
    fireEvent.click(screen.getByRole("checkbox", { name: "Sorting" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Show the hidden files in “Sorting”?");
    expect(dialog).toHaveTextContent("1 hidden file will be shown to students");
    expect(dialog).toHaveTextContent(
      "1 file stays hidden, under another hidden topic or in Canvas.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Show files" }));

    await waitFor(() =>
      expect(patches[0]?.body).toEqual({
        fileGroup: { scope: "topic", topicId: "t1", visibleToStudents: true },
      }),
    );
  });

  it("asks before showing a hidden topic, counting only the files that become visible", async () => {
    server.topics[0].visibleToStudents = false;
    // m2 is also under Exam prep (shown), m1 is Canvas-hidden, so only m2 comes back.
    server.files[0].hiddenByCanvas = true;
    await renderSettings();
    openTopics();
    fireEvent.click(screen.getByRole("checkbox", { name: "Sorting" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Show “Sorting” to students?");
    expect(dialog).toHaveTextContent("1 hidden file will be shown to students");
    expect(dialog).toHaveTextContent("1 hidden topic will be shown too.");
    expect(dialog).toHaveTextContent("1 file stays hidden");
    expect(patches).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Show files" }));

    await waitFor(() =>
      expect(patches[0]?.body).toEqual({ topics: [{ id: "t1", visibleToStudents: true }] }),
    );
  });

  it("shows a hidden topic without asking when no file comes back with it", async () => {
    server.topics[0].visibleToStudents = false;
    server.files = [file("m3", ["t2"]), file("m4", [])];
    await renderSettings();
    openTopics();
    fireEvent.click(screen.getByRole("checkbox", { name: "Sorting" }));

    await waitFor(() =>
      expect(patches[0]?.body).toEqual({ topics: [{ id: "t1", visibleToStudents: true }] }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("does not claim topics will be shown when a topic's reveal only touches a file another topic hides", async () => {
    server.topics[1].visibleToStudents = false;
    server.files = [file("m1", ["t1"]), file("m2", ["t1", "t2"], { visibleToStudents: false })];
    await renderSettings();
    openTopics();
    fireEvent.click(screen.getByRole("checkbox", { name: "Sorting" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("No file will be shown to students yet.");
    expect(dialog).not.toHaveTextContent("hidden topic will be shown");
  });

  it("names the hidden topics that showing hidden files shows too", async () => {
    server.topics[1].visibleToStudents = false;
    server.files[0].visibleToStudents = false;
    const all = await renderSettings();
    fireEvent.click(all);

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("3 hidden files will be shown to students");
    expect(dialog).toHaveTextContent("1 hidden topic will be shown too.");
  });

  it("hides the files with no topic at once, and asks before showing them again", async () => {
    await renderSettings();
    openTopics();
    fireEvent.click(screen.getByRole("checkbox", { name: "No topic" }));

    await waitFor(() =>
      expect(patches[0]?.body).toEqual({
        fileGroup: { scope: "unfiled", visibleToStudents: false },
      }),
    );
    await waitFor(() => expect(stateOf("No topic")).toBe("unchecked"));

    fireEvent.click(screen.getByRole("checkbox", { name: "No topic" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("1 hidden file will be shown");
  });

  it("shows or hides a single file from inside its topic", async () => {
    await renderSettings();
    openTopics();
    openFiles("Sorting");
    fireEvent.click(screen.getByRole("checkbox", { name: "File m1" }));

    await waitFor(() =>
      expect(patches[0]?.body).toEqual({ materials: [{ id: "m1", visibleToStudents: false }] }),
    );
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "File m1" })).not.toBeChecked(),
    );
  });

  it("counts a file Canvas hides as hidden, and does not offer to show it", async () => {
    server.files[3].hiddenByCanvas = true;
    await renderSettings();

    expect(
      screen.getByText(
        "3 of 4 files are shown to students, and 1 is hidden. 1 file is hidden in Canvas.",
      ),
    ).toBeInTheDocument();
    openTopics();
    openFiles("No topic");
    expect(screen.getByText("Hidden in Canvas")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "File m4" })).toBeDisabled();
  });

  it("lists a large group a step at a time", async () => {
    server.files = Array.from({ length: 250 }, (_, i) => file(`u${i}`, []));
    await renderSettings();
    openTopics();
    openFiles("No topic");

    expect(screen.getAllByRole("checkbox", { name: /^File u/ })).toHaveLength(200);
    fireEvent.click(screen.getByRole("button", { name: "Show more (50 not listed)" }));
    expect(screen.getAllByRole("checkbox", { name: /^File u/ })).toHaveLength(250);
  });

  it("schedules a file for a later date", async () => {
    await renderSettings();
    openTopics();
    openFiles("Sorting");
    fireEvent.click(screen.getByRole("button", { name: "Schedule File m1" }));
    fireEvent.change(screen.getByLabelText("Show from"), {
      target: { value: "2099-03-04T09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].url).toBe("/api/courses/c1/materials/m1");
    expect(patches[0].body).toEqual({ availableAt: new Date("2099-03-04T09:30").toISOString() });
    await waitFor(() => expect(screen.queryByLabelText("Show from")).toBeNull());
    expect(screen.getByText(/1 shown file waits for its scheduled date/)).toBeInTheDocument();
  });

  it("clears a file's schedule", async () => {
    server.files[0].availableAt = "2099-01-01T00:00:00.000Z";
    await renderSettings();
    openTopics();
    openFiles("Sorting");
    fireEvent.click(screen.getByRole("button", { name: "Schedule File m1" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patches[0]?.body).toEqual({ availableAt: null }));
  });

  it("says inside the schedule dialog when the date cannot be saved", async () => {
    await renderSettings();
    openTopics();
    openFiles("Sorting");
    fireEvent.click(screen.getByRole("button", { name: "Schedule File m1" }));
    fetchMock.mockImplementationOnce(async () => Response.json({ error: "x" }, { status: 403 }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Could not save the date. Try again.",
    );
  });

  it("saves the browse switch as soon as it is flipped", async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole("switch", { name: "Let students browse files" }));

    await waitFor(() => expect(patches[0]?.body).toEqual({ studentFilesVisible: true }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Let students browse files" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
  });

  it("says so when a change is refused, and shows the settings as stored", async () => {
    const all = await renderSettings();
    fetchMock.mockImplementationOnce(async () => Response.json({ error: "x" }, { status: 403 }));
    fireEvent.click(all);
    fireEvent.click(screen.getByRole("button", { name: "Hide all materials" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
    expect(stateOf("Show course materials to students")).toBe("checked");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("does not call a saved change a failure when only the refresh after it fails", async () => {
    await renderSettings(() => {
      throw new Error("refetch failed");
    });
    fireEvent.click(screen.getByRole("switch", { name: "Let students browse files" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Saved, but the list could not refresh",
    );
    expect(server.studentFilesVisible).toBe(true);
  });

  it("says so when the settings cannot be loaded", async () => {
    fetchMock.mockImplementationOnce(async () => Response.json({ error: "x" }, { status: 500 }));
    render(
      <MemoryRouter>
        <CourseStudentVisibilitySettings courseId="c1" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load what students see");
  });

  it("points to the Materials tab when the course has no files or topics yet", async () => {
    server = { studentFilesVisible: false, topics: [], files: [] };
    render(
      <MemoryRouter>
        <CourseStudentVisibilitySettings courseId="c1" />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/No files yet/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("describeFileVisibility (#2061)", () => {
  const none = { hiddenByCanvas: 0, scheduled: 0, hiddenTopics: 0 };
  it.each<[Parameters<typeof describeFileVisibility>[0], string]>([
    [{ total: 0, shown: 0, ...none }, "No files yet."],
    [{ total: 1, shown: 1, ...none }, "Your 1 file is shown to students."],
    [{ total: 2, shown: 2, ...none }, "All 2 files are shown to students."],
    [{ total: 1, shown: 0, ...none }, "Your 1 file is hidden from students."],
    [{ total: 2, shown: 0, ...none }, "All 2 files are hidden from students."],
    [{ total: 3, shown: 2, ...none }, "2 of 3 files are shown to students, and 1 is hidden."],
    [
      { total: 2, shown: 2, ...none, scheduled: 1 },
      "All 2 files are shown to students. 1 shown file waits for its scheduled date.",
    ],
    [
      { total: 3, shown: 1, ...none, hiddenByCanvas: 2, hiddenTopics: 1 },
      "1 of 3 files are shown to students, and 2 are hidden. 2 files are hidden in Canvas. 1 topic is hidden.",
    ],
  ])("%#: reads %s", (counts, text) => {
    expect(describeFileVisibility(counts)).toBe(text);
  });

  it.each([
    [[0, 0, false, 2], "2 hidden topics will be shown to students."],
    [[0, 0, false, 1], "1 hidden topic will be shown to students."],
    [
      [0, 1, false, 0],
      "No file will be shown to students yet. 1 file stays hidden, under another hidden topic or in Canvas.",
    ],
    [[0, 0, true, 0], "No file will be shown to students yet."],
  ] as const)(
    "%#: describes a reveal of %j",
    ([revealed, stillHidden, scheduled, topics], text) => {
      expect(revealDescription(revealed, stillHidden, scheduled, topics)).toBe(text);
    },
  );

  it("names the hidden topics a reveal of files shows too", () => {
    const text = revealDescription(2, 0, false, 2);
    expect(text).toContain("2 hidden files will be shown to students");
    expect(text).toContain("2 hidden topics will be shown too.");
  });
});
