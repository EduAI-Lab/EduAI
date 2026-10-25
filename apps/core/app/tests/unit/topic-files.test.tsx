// #1997: files ↔ topics from the topic's side on the Topics tab.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/api/course-material-lookup", () => ({
  fetchAllCourseMaterials: vi.fn(),
  fetchCourseMaterialsByIds: vi.fn(),
}));

import { TopicFiles } from "~/components/courses/topic-files";
import {
  fetchAllCourseMaterials,
  fetchCourseMaterialsByIds,
} from "~/hooks/api/course-material-lookup";
import type { CourseTopic } from "~/hooks/api/use-course-topics";
import type { CourseMaterial } from "~/hooks/api/use-course-materials";
import { hasTopic, topicsWithAdded, topicsWithRemoved } from "~/lib/topics/topic-links";

const T = (id: string, name = id) => ({ id, name });

function topic(overrides: Partial<CourseTopic> = {}): CourseTopic {
  return {
    id: "loops",
    courseId: "c1",
    name: "Loops",
    origin: "HUMAN",
    reviewStatus: "ACCEPTED",
    sources: [],
    sourceCount: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function file(id: string, topics: Array<{ id: string; name: string }>, uploadedBy = "i1") {
  return {
    id,
    courseId: "c1",
    title: `${id}.pdf`,
    mimeType: "application/pdf",
    fileSize: 1,
    status: "READY",
    createdAt: "",
    updatedAt: "",
    processedAt: null,
    uploadedBy,
    topics,
  } as CourseMaterial;
}

describe("topic-links helpers", () => {
  it("adds a topic last so the main topic stays first", () => {
    expect(topicsWithAdded([T("a"), T("b")], "loops")).toEqual([
      { topicId: "a" },
      { topicId: "b" },
      { topicId: "loops" },
    ]);
  });

  it("refuses a fourth topic and leaves an existing link alone", () => {
    expect(topicsWithAdded([T("a"), T("b"), T("c")], "loops")).toBeNull();
    expect(topicsWithAdded([T("a"), T("loops"), T("c")], "loops")).toEqual([
      { topicId: "a" },
      { topicId: "loops" },
      { topicId: "c" },
    ]);
  });

  it("removes only that topic, keeping the others in order", () => {
    expect(topicsWithRemoved([T("a"), T("loops"), T("c")], "loops")).toEqual([
      { topicId: "a" },
      { topicId: "c" },
    ]);
    expect(hasTopic([T("loops")], "loops")).toBe(true);
  });
});

describe("TopicFiles (#1997)", () => {
  const onSetMaterialTopics = vi.fn();
  const onChanged = vi.fn();
  const canEditFile = vi.fn((m: CourseMaterial) => m.uploadedBy !== "someone-else");

  beforeEach(() => {
    vi.clearAllMocks();
    onSetMaterialTopics.mockResolvedValue([]);
    canEditFile.mockImplementation((m: CourseMaterial) => m.uploadedBy !== "someone-else");
  });

  function renderFiles(t: CourseTopic, editable = true) {
    render(
      <TopicFiles
        courseId="c1"
        topic={t}
        onSetMaterialTopics={editable ? onSetMaterialTopics : undefined}
        canEditFile={canEditFile}
        onChanged={onChanged}
      />,
    );
  }

  it("flags a topic with no files", () => {
    renderFiles(topic());
    expect(screen.getByText("No files yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /link files/i })).toBeInTheDocument();
  });

  it("lists the topic's files and how many more there are", () => {
    renderFiles(
      topic({
        sources: [
          { materialId: "f1", title: "f1.pdf" },
          { materialId: "f2", title: null },
        ],
        sourceCount: 7,
      }),
    );
    expect(screen.getByText("f1.pdf")).toBeInTheDocument();
    expect(screen.getByText("Untitled file")).toBeInTheDocument();
    expect(screen.getByText("and 5 more")).toBeInTheDocument();
    expect(screen.queryByText("No files yet")).toBeNull();
  });

  it("shows the list without controls to a viewer who can't change topics", () => {
    renderFiles(topic({ sources: [{ materialId: "f1", title: "f1.pdf" }], sourceCount: 1 }), false);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("unlinks a file using its current topics, read fresh", async () => {
    vi.mocked(fetchCourseMaterialsByIds).mockResolvedValue([
      file("f1", [T("intro"), T("loops"), T("arrays")]),
    ]);
    renderFiles(topic({ sources: [{ materialId: "f1", title: "f1.pdf" }], sourceCount: 1 }));

    fireEvent.click(screen.getByRole("button", { name: "Unlink f1.pdf from Loops" }));

    await waitFor(() =>
      expect(onSetMaterialTopics).toHaveBeenCalledWith("f1", [
        { topicId: "intro" },
        { topicId: "arrays" },
      ]),
    );
    expect(fetchCourseMaterialsByIds).toHaveBeenCalledWith("c1", ["f1"]);
    expect(onChanged).toHaveBeenCalled();
  });

  it("explains a refused unlink", async () => {
    vi.mocked(fetchCourseMaterialsByIds).mockResolvedValue([
      file("f1", [T("loops")], "someone-else"),
    ]);
    renderFiles(topic({ sources: [{ materialId: "f1", title: "f1.pdf" }], sourceCount: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Unlink f1.pdf from Loops" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You can't change that file's topics.",
    );
    expect(onSetMaterialTopics).not.toHaveBeenCalled();
  });

  describe("Link files", () => {
    beforeEach(() => {
      vi.mocked(fetchAllCourseMaterials).mockResolvedValue({
        truncated: false,
        materials: [
          file("linked", [T("intro"), T("loops")]),
          file("free", [T("intro")]),
          file("full", [T("a"), T("b"), T("c")]),
          file("theirs", [], "someone-else"),
        ],
      });
    });

    async function openDialog() {
      renderFiles(topic());
      fireEvent.click(screen.getByRole("button", { name: /link files/i }));
      const dialog = await screen.findByRole("dialog");
      await within(dialog).findByLabelText(/free\.pdf/);
      return dialog;
    }

    it("lists every course file, ticks the linked ones, and locks files it can't change", async () => {
      const dialog = await openDialog();
      expect(fetchAllCourseMaterials).toHaveBeenCalledWith("c1");
      expect(within(dialog).getByRole("checkbox", { name: /linked\.pdf/ })).toBeChecked();
      expect(within(dialog).getByRole("checkbox", { name: /free\.pdf/ })).not.toBeChecked();
      expect(within(dialog).getByRole("checkbox", { name: /full\.pdf/ })).toBeDisabled();
      expect(within(dialog).getByText("Already has 3 topics")).toBeInTheDocument();
      expect(within(dialog).getByRole("checkbox", { name: /theirs\.pdf/ })).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("saves only the files that changed: links add the topic last, unlinks remove it", async () => {
      const dialog = await openDialog();
      fireEvent.click(within(dialog).getByRole("checkbox", { name: /free\.pdf/ }));
      fireEvent.click(within(dialog).getByRole("checkbox", { name: /linked\.pdf/ }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Save 2 changes" }));

      await waitFor(() => expect(onSetMaterialTopics).toHaveBeenCalledTimes(2));
      expect(onSetMaterialTopics).toHaveBeenCalledWith("linked", [{ topicId: "intro" }]);
      expect(onSetMaterialTopics).toHaveBeenCalledWith("free", [
        { topicId: "intro" },
        { topicId: "loops" },
      ]);
      expect(onChanged).toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("keeps the dialog open and names each file whose save failed", async () => {
      onSetMaterialTopics.mockRejectedValueOnce(new Error("TOO_MANY_TOPICS"));
      const dialog = await openDialog();
      fireEvent.click(within(dialog).getByRole("checkbox", { name: /free\.pdf/ }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Save 1 change" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "free.pdf: That file already has 3 topics.",
      );
    });

    it("filters the files by search", async () => {
      const dialog = await openDialog();
      fireEvent.change(within(dialog).getByLabelText("Search files"), { target: { value: "fre" } });
      expect(within(dialog).getAllByRole("checkbox")).toHaveLength(1);
    });
  });
});
