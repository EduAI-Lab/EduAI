import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { MaterialTopicsEditor } from "~/components/courses/material-topics-editor";
import { TopicAnalysisBanner } from "~/components/courses/topic-analysis-banner";
import type { TopicAnalysisStatus } from "~/hooks/api/use-topic-analysis";

const COURSE_TOPICS = [
  { id: "t1", name: "Limits" },
  { id: "t2", name: "Derivatives" },
  { id: "t3", name: "Integrals" },
  { id: "t4", name: "Series" },
];

function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: /topic/i }));
}

describe("MaterialTopicsEditor (#1965)", () => {
  it("shows the material's topics, or No topic", () => {
    const { rerender } = render(
      <MaterialTopicsEditor topics={[{ id: "t1", name: "Limits" }]} courseTopics={COURSE_TOPICS} />,
    );
    expect(screen.getByText("Limits")).toHaveAttribute("title", "Main topic");
    expect(screen.queryByRole("button")).toBeNull();

    rerender(<MaterialTopicsEditor topics={[]} courseTopics={COURSE_TOPICS} />);
    expect(screen.getByText("No topic")).toBeInTheDocument();
  });

  it("saves the picked topics in the order they were chosen", async () => {
    const onSave = vi.fn(async () => {});
    render(<MaterialTopicsEditor topics={[]} courseTopics={COURSE_TOPICS} onSave={onSave} />);

    openPicker();
    fireEvent.click(screen.getByLabelText("Integrals"));
    fireEvent.click(screen.getByLabelText("Limits"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith([{ topicId: "t3" }, { topicId: "t1" }]),
    );
  });

  // #1997: the list used to sit in a short box that showed only about four
  // topics; every topic is now reachable by search, and the count is shown.
  it("lists every course topic, searchable, with a count", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`,
      name: `Week ${i + 1} topic`,
    }));
    render(<MaterialTopicsEditor topics={[]} courseTopics={many} onSave={vi.fn()} />);
    openPicker();

    const list = screen.getByRole("group", { name: "Course topics" });
    expect(list.querySelectorAll('button[role="checkbox"]')).toHaveLength(12);
    expect(screen.getByText("12 topics")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search topics"), { target: { value: "week 1" } });
    // "Week 1", "Week 10", "Week 11", "Week 12".
    expect(list.querySelectorAll('button[role="checkbox"]')).toHaveLength(4);
    expect(screen.getByText("4 of 12 topics")).toBeInTheDocument();
    expect(screen.getByLabelText("Week 12 topic")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search topics"), { target: { value: "zzz" } });
    expect(screen.getByText("No topic matches.")).toBeInTheDocument();
  });

  it("keeps a picked topic picked while searching for another", async () => {
    const onSave = vi.fn(async () => {});
    render(<MaterialTopicsEditor topics={[]} courseTopics={COURSE_TOPICS} onSave={onSave} />);
    openPicker();
    fireEvent.click(screen.getByLabelText("Limits"));
    fireEvent.change(screen.getByLabelText("Search topics"), { target: { value: "ser" } });
    fireEvent.click(screen.getByLabelText("Series"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith([{ topicId: "t1" }, { topicId: "t4" }]),
    );
  });

  // #1998: automatic topics are labelled until a person confirms or changes them.
  describe("automatic topics (#1998)", () => {
    const AUTO = [
      { id: "t1", name: "Limits", matchedBy: "AI" as const, matchConfidence: 70 },
      { id: "t2", name: "Derivatives", matchedBy: "NAME" as const, matchConfidence: null },
    ];

    it("labels AI and name matches, and confirms them as they are", async () => {
      const onSave = vi.fn(async () => {});
      render(<MaterialTopicsEditor topics={AUTO} courseTopics={COURSE_TOPICS} onSave={onSave} />);

      expect(screen.getByText("AI · 70%")).toHaveAttribute(
        "title",
        expect.stringContaining("the model's own estimate is 70%"),
      );
      expect(screen.getByText("Matched by name")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
      await waitFor(() =>
        expect(onSave).toHaveBeenCalledWith([{ topicId: "t1" }, { topicId: "t2" }]),
      );
    });

    it("shows plain AI when the model gave no confidence", () => {
      render(
        <MaterialTopicsEditor
          topics={[{ id: "t1", name: "Limits", matchedBy: "AI", matchConfidence: null }]}
          courseTopics={COURSE_TOPICS}
        />,
      );
      expect(screen.getByText("AI")).toBeInTheDocument();
    });

    it("drops the labels and Confirm once a person has set the topics", () => {
      render(
        <MaterialTopicsEditor
          topics={AUTO}
          courseTopics={COURSE_TOPICS}
          onSave={vi.fn()}
          setManually
        />,
      );
      expect(screen.queryByText("AI · 70%")).toBeNull();
      expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    });

    it("offers no Confirm to a viewer who can't change the topics", () => {
      render(<MaterialTopicsEditor topics={AUTO} courseTopics={COURSE_TOPICS} />);
      expect(screen.getByText("AI · 70%")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    });

    it("has nothing to confirm when no topic is automatic", () => {
      render(
        <MaterialTopicsEditor
          topics={[{ id: "t1", name: "Limits" }]}
          courseTopics={COURSE_TOPICS}
          onSave={vi.fn()}
        />,
      );
      expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    });
  });

  it("stops at three topics", () => {
    render(<MaterialTopicsEditor topics={[]} courseTopics={COURSE_TOPICS} onSave={vi.fn()} />);

    openPicker();
    for (const name of ["Limits", "Derivatives", "Integrals"]) {
      fireEvent.click(screen.getByLabelText(name));
    }

    expect(screen.getByLabelText("Series")).toBeDisabled();
  });

  it("selects an existing topic for a typed near-duplicate, and adds a new name", async () => {
    const onSave = vi.fn(async () => {});
    render(
      <MaterialTopicsEditor topics={[]} courseTopics={COURSE_TOPICS} onSave={onSave} canCreate />,
    );

    openPicker();
    const input = screen.getByLabelText("New topic name");
    fireEvent.change(input, { target: { value: "limit" } });
    fireEvent.click(screen.getByRole("button", { name: /add$/i }));
    fireEvent.change(input, { target: { value: "Vectors" } });
    fireEvent.click(screen.getByRole("button", { name: /add$/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith([{ topicId: "t1" }, { name: "Vectors" }]),
    );
  });

  it("hides the new-topic field from someone who can't create topics", () => {
    render(<MaterialTopicsEditor topics={[]} courseTopics={COURSE_TOPICS} onSave={vi.fn()} />);

    openPicker();
    expect(screen.queryByLabelText("New topic name")).toBeNull();
  });

  it("explains a refused save", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("TOPIC_NAME_TAKEN");
    });
    render(<MaterialTopicsEditor topics={[]} courseTopics={COURSE_TOPICS} onSave={onSave} />);

    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/already uses that name/)).toBeInTheDocument();
  });
});

function completed(job: Partial<NonNullable<TopicAnalysisStatus["job"]>>): TopicAnalysisStatus {
  return {
    job: {
      id: "job-1",
      status: "COMPLETED",
      errorMessage: null,
      createdAt: "2026-10-15T00:00:00.000Z",
      completedAt: "2026-10-15T00:00:01.000Z",
      created: null,
      usedSource: null,
      matched: null,
      unmatched: null,
      mode: "match",
      ...job,
    },
    pendingSuggestions: 0,
    unfiledMaterials: 0,
  };
}

describe("TopicAnalysisBanner match summary (#1965)", () => {
  it("reports filed and unfiled files", () => {
    render(
      <TopicAnalysisBanner status={completed({ matched: 2, unmatched: 1 })} onRetry={vi.fn()} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Filed 2 files under existing topics. 1 file didn't fit any topic.",
    );
  });

  it("reports when nothing fit", () => {
    render(
      <TopicAnalysisBanner status={completed({ matched: 0, unmatched: 3 })} onRetry={vi.fn()} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("3 files didn't fit any topic.");
  });

  it("says nothing when there was nothing to file", () => {
    const { container } = render(
      <TopicAnalysisBanner status={completed({ matched: 0, unmatched: 0 })} onRetry={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("still describes a job from before matching", () => {
    render(
      <TopicAnalysisBanner
        status={completed({ created: 2, usedSource: "material-headings" })}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Suggested 2 topics");
  });
});
