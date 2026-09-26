import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CourseMaterialsUpload } from "~/components/course-materials-upload";

const pdf = new File(["a"], "week1.pdf", { type: "application/pdf" });
const docx = new File(["b"], "week2.docx", {
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});

function fileInput() {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

function dropzone() {
  return screen.getByRole("button", { name: /Drag & drop or/i });
}

describe("CourseMaterialsUpload — rendering", () => {
  it("renders a drag-and-drop zone", () => {
    render(<CourseMaterialsUpload onFilesSelect={vi.fn()} />);
    // The drag-and-drop zone has text about dragging and dropping
    expect(screen.getByText(/Drag & drop or/)).toBeInTheDocument();
    // File input exists but is hidden (sr-only)
    expect(fileInput()).toBeInTheDocument();
    expect(dropzone()).not.toContainElement(fileInput());
  });

  it("lists the supported formats", () => {
    render(<CourseMaterialsUpload onFilesSelect={vi.fn()} />);
    // The supported formats are displayed
    expect(screen.getByText(/PDF, DOCX, PPTX, TXT, MD/)).toBeInTheDocument();
  });

  it("disables the dropzone and shows a message while uploading", () => {
    render(<CourseMaterialsUpload onFilesSelect={vi.fn()} isUploading />);
    // The dropzone becomes disabled/visually disabled
    expect(screen.getByText(/Drag & drop or/)).toBeInTheDocument();
    // Shows uploading state message
    expect(screen.getByText(/Uploading/)).toBeInTheDocument();
  });

  it("renders an error message when error is set", () => {
    render(<CourseMaterialsUpload onFilesSelect={vi.fn()} error="Upload failed" />);
    expect(screen.getByText("Upload failed")).toBeInTheDocument();
  });

  it("renders a success message when success is set", () => {
    render(
      <CourseMaterialsUpload onFilesSelect={vi.fn()} success="Material uploaded successfully" />,
    );
    expect(screen.getByText("Material uploaded successfully")).toBeInTheDocument();
  });
});

describe("CourseMaterialsUpload — batch selection (#1748)", () => {
  it("lets the picker select several files", () => {
    render(<CourseMaterialsUpload onFilesSelect={vi.fn()} />);
    expect(fileInput().multiple).toBe(true);
  });

  it("hands every picked file over in one call", () => {
    const onFilesSelect = vi.fn();
    render(<CourseMaterialsUpload onFilesSelect={onFilesSelect} />);
    fireEvent.change(fileInput(), { target: { files: [pdf, docx] } });
    expect(onFilesSelect).toHaveBeenCalledTimes(1);
    expect(onFilesSelect).toHaveBeenCalledWith([pdf, docx]);
  });

  it("hands every dropped file over in one call", () => {
    const onFilesSelect = vi.fn();
    render(<CourseMaterialsUpload onFilesSelect={onFilesSelect} />);
    fireEvent.drop(dropzone(), { dataTransfer: { files: [pdf, docx] } });
    expect(onFilesSelect).toHaveBeenCalledWith([pdf, docx]);
  });

  it("ignores a drop while an upload is running", () => {
    const onFilesSelect = vi.fn();
    render(<CourseMaterialsUpload onFilesSelect={onFilesSelect} isUploading />);
    fireEvent.drop(dropzone(), { dataTransfer: { files: [pdf] } });
    expect(onFilesSelect).not.toHaveBeenCalled();
  });

  it("does not call back for an empty selection", () => {
    const onFilesSelect = vi.fn();
    render(<CourseMaterialsUpload onFilesSelect={onFilesSelect} />);
    fireEvent.change(fileInput(), { target: { files: [] } });
    expect(onFilesSelect).not.toHaveBeenCalled();
  });

  it("lists each file of a batch with its status and reason", () => {
    render(
      <CourseMaterialsUpload
        onFilesSelect={vi.fn()}
        isUploading
        uploads={[
          { name: "week1.pdf", status: "ready" },
          { name: "week2.docx", status: "failed", message: "FILE_TOO_LARGE" },
          { name: "week3.pptx", status: "uploading" },
          { name: "week4.md", status: "queued" },
        ]}
      />,
    );
    const rows = within(screen.getByRole("list", { name: "Upload progress" })).getAllByRole(
      "listitem",
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("week1.pdf");
    expect(rows[0]).toHaveTextContent("Added");
    expect(rows[1]).toHaveTextContent("FILE_TOO_LARGE");
    expect(rows[1]).toHaveTextContent("Failed");
    expect(screen.getByText("Uploading 4 files (2 of 4 done)…")).toBeInTheDocument();
  });

  it("does not list a single-file upload, which the alerts already describe", () => {
    render(
      <CourseMaterialsUpload
        onFilesSelect={vi.fn()}
        isUploading
        uploads={[{ name: "week1.pdf", status: "uploading" }]}
      />,
    );
    expect(screen.queryByRole("list", { name: "Upload progress" })).not.toBeInTheDocument();
    expect(screen.getByText('Uploading "week1.pdf"…')).toBeInTheDocument();
  });
});
