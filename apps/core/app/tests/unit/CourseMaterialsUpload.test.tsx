import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CourseMaterialsUpload } from "~/components/course-materials-upload";

describe("CourseMaterialsUpload — rendering", () => {
  it("renders a file input", () => {
    render(<CourseMaterialsUpload onFileSelect={vi.fn()} />);
    expect(screen.getByLabelText("Select file")).toHaveAttribute("type", "file");
  });

  it("lists the supported formats", () => {
    render(<CourseMaterialsUpload onFileSelect={vi.fn()} />);
    expect(screen.getByText(/Supported formats/)).toBeInTheDocument();
  });

  it("disables the file input and shows a message while uploading", () => {
    render(<CourseMaterialsUpload onFileSelect={vi.fn()} isUploading />);
    expect(screen.getByLabelText("Select file")).toBeDisabled();
    expect(screen.getByText(/Uploading and processing/)).toBeInTheDocument();
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
