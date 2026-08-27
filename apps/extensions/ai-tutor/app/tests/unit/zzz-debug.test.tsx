import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, vi, expect } from "vitest";
import { Dialog, DialogContent } from "@eduai/ui";
import { CourseTopicsProvider } from "~/hooks/useCourseTopics";
import AddActivityPanel from "~/components/AddActivityPanel";

const mockCreate = vi.fn().mockResolvedValue({});
vi.mock("~/lib/api", () => ({ default: { createActivity: (...a: any[]) => mockCreate(...a) } }));

describe("debug", () => {
  it("debug", async () => {
    render(
      <CourseTopicsProvider value={{ topics: [{id:"t1",name:"Recursion"}], total:1, loading:false, error:null, refresh:vi.fn(), createTopic:vi.fn(), loadMore:vi.fn(), loadingMore:false }}>
        <Dialog open>
          <DialogContent>
            <AddActivityPanel lessonId={7} onActivityCreated={vi.fn()} />
          </DialogContent>
        </Dialog>
      </CourseTopicsProvider>
    );
    fireEvent.change(screen.getByLabelText(/Question prompt/i), { target: { value: "hi" } });
    const btn = screen.getByRole("button", { name: /^Add activity$/i });
    await act(async () => {
      fireEvent.click(btn);
    });
    console.log("called times", mockCreate.mock.calls.length);
  });
});
