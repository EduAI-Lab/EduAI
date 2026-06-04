import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CourseMaterialsUpload } from "~/components/course-materials-upload";
import type { CourseMaterial } from "~/components/course-materials-upload";

const sampleMaterials: CourseMaterial[] = [
  {
    id: "1",
    title: "Lecture 1 Notes",
    mimeType: "application/pdf",
    fileSize: 1024,
    status: "READY",
    createdAt: "2026-01-01T00:00:00.000Z",
    chunks: [{ id: "c1", content: "hello" }],
  },
];

describe("CourseMaterialsUpload — rendering", () => {
  it("renders the upload card heading", () => {
    render(<CourseMaterialsUpload materials={sampleMaterials} onFileSelect={vi.fn()} />);
    expect(screen.getByText("Upload Course Materials")).toBeInTheDocument();
  });

  it("renders a file input", () => {
    render(<CourseMaterialsUpload materials={sampleMaterials} onFileSelect={vi.fn()} />);
    expect(screen.getByLabelText("Select File")).toHaveAttribute("type", "file");
  });

  it("renders each material's title", () => {
    render(<CourseMaterialsUpload materials={sampleMaterials} onFileSelect={vi.fn()} />);
    expect(screen.getByText("Lecture 1 Notes")).toBeInTheDocument();
  });

  it("shows the total material count", () => {
    render(<CourseMaterialsUpload materials={sampleMaterials} onFileSelect={vi.fn()} />);
    expect(screen.getByText(/1 total/)).toBeInTheDocument();
  });

  it("disables the file input and shows a message while uploading", () => {
    render(
      <CourseMaterialsUpload materials={sampleMaterials} onFileSelect={vi.fn()} isUploading />
    );
    expect(screen.getByLabelText("Select File")).toBeDisabled();
    expect(screen.getByText(/Uploading and processing/)).toBeInTheDocument();
  });

  it("renders an error message when error is set", () => {
    render(
      <CourseMaterialsUpload
        materials={sampleMaterials}
        onFileSelect={vi.fn()}
        error="Upload failed"
      />
    );
    expect(screen.getByText("Upload failed")).toBeInTheDocument();
  });

  it("renders a success message when success is set", () => {
    render(
      <CourseMaterialsUpload
        materials={sampleMaterials}
        onFileSelect={vi.fn()}
        success="Material uploaded successfully!"
      />
    );
    expect(screen.getByText("Material uploaded successfully!")).toBeInTheDocument();
  });
});

describe("CourseMaterialsUpload — missing data", () => {
  it("renders an empty state when there are no materials", () => {
    render(<CourseMaterialsUpload materials={[]} onFileSelect={vi.fn()} />);
    expect(screen.getByText(/No materials uploaded yet/)).toBeInTheDocument();
  });

  it("shows a total count of 0 with no materials", () => {
    render(<CourseMaterialsUpload materials={[]} onFileSelect={vi.fn()} />);
    expect(screen.getByText(/0 total/)).toBeInTheDocument();
  });
});
