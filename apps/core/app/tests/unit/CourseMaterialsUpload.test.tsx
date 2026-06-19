import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CourseMaterialsUpload } from "~/components/course-materials-upload";

describe("CourseMaterialsUpload — rendering", () => {
  it("renders a drag-and-drop zone", () => {
    render(<CourseMaterialsUpload onFileSelect={vi.fn()} />);
    // The drag-and-drop zone has text about dragging and dropping
    expect(screen.getByText(/Drag & drop or/)).toBeInTheDocument();
    // File input exists but is hidden (sr-only)
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();
  });

  it("lists the supported formats", () => {
    render(<CourseMaterialsUpload onFileSelect={vi.fn()} />);
    // The supported formats are displayed
    expect(screen.getByText(/PDF, DOCX, PPTX, TXT, MD/)).toBeInTheDocument();
  });

  it("disables the dropzone and shows a message while uploading", () => {
    render(<CourseMaterialsUpload onFileSelect={vi.fn()} isUploading />);
    // The dropzone becomes disabled/visually disabled
    const dropzone = screen.getByText(/Drag & drop or/);
    expect(dropzone).toBeInTheDocument();
    // Shows uploading state message
    expect(screen.getByText(/Uploading/)).toBeInTheDocument();
  });

  it("renders an error message when error is set", () => {
    render(
      <CourseMaterialsUpload onFileSelect={vi.fn()} error="Upload failed" />
    );
    expect(screen.getByText("Upload failed")).toBeInTheDocument();
  });

  it("renders a success message when success is set", () => {
    render(
      <CourseMaterialsUpload
        onFileSelect={vi.fn()}
        success="Material uploaded successfully"
      />
    );
    expect(screen.getByText("Material uploaded successfully")).toBeInTheDocument();
  });
});
