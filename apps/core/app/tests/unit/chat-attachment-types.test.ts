import { describe, expect, it } from "vitest";
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_ATTACHMENT_TEXT_EXTENSIONS,
  classifyAttachmentName,
} from "~/lib/chat/attachment-types";

describe("classifyAttachmentName", () => {
  it.each([
    ["notes.pdf", "application/pdf"],
    ["Lecture.DOCX", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["readme.md", "text/markdown"],
    ["plain.txt", "text/plain"],
  ])("routes %s to the document pipeline as %s", (name, mimeType) => {
    expect(classifyAttachmentName(name)).toEqual({ kind: "document", mimeType });
  });

  it.each(["analysis.R", "query.sql", "main.py", "data.csv", "App.java", "x.cpp", "run.sh"])(
    "routes %s to plain-text decoding",
    (name) => {
      expect(classifyAttachmentName(name)).toEqual({ kind: "text" });
    },
  );

  it.each([
    "photo.png",
    "scan.jpg",
    "scan.JPEG",
    "diagram.webp",
    "book.xlsx",
    "archive.zip",
    "noextension",
    "notebook.ipynb",
  ])("rejects %s", (name) => {
    expect(classifyAttachmentName(name)).toBeNull();
  });
});

describe("CHAT_ATTACHMENT_ACCEPT", () => {
  it("lists every document and text extension for the file input", () => {
    for (const ext of [
      ".pdf",
      ".docx",
      ".pptx",
      ".txt",
      ".md",
      ...CHAT_ATTACHMENT_TEXT_EXTENSIONS,
    ]) {
      expect(CHAT_ATTACHMENT_ACCEPT.split(",")).toContain(ext);
    }
  });

  // #1903 added image course materials to the shared list; chat stays text-only.
  it("offers no image extension even though course materials accept images", () => {
    for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
      expect(CHAT_ATTACHMENT_ACCEPT.split(",")).not.toContain(ext);
    }
  });
});
