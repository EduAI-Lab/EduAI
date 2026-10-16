import { describe, expect, it } from "vitest";
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_ATTACHMENT_TEXT_EXTENSIONS,
  chatImageExtensionFor,
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

  // #1742: images are transcribed by the vision model.
  it.each([
    ["photo.png", "image/png"],
    ["scan.jpg", "image/jpeg"],
    ["scan.JPEG", "image/jpeg"],
    ["diagram.webp", "image/webp"],
  ])("routes %s to the vision model as %s", (name, mimeType) => {
    expect(classifyAttachmentName(name)).toEqual({ kind: "image", mimeType });
  });

  it.each([
    "animation.gif",
    "phone.heic",
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

  it("offers the image extensions the vision model reads (#1742)", () => {
    for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
      expect(CHAT_ATTACHMENT_ACCEPT.split(",")).toContain(ext);
    }
  });
});

describe("chatImageExtensionFor", () => {
  it.each([
    ["image/png", ".png"],
    ["image/jpeg", ".jpg"],
    ["image/webp", ".webp"],
    ["image/gif", null],
    ["application/pdf", null],
  ])("maps %s to %s", (mimeType, extension) => {
    expect(chatImageExtensionFor(mimeType)).toBe(extension);
  });
});
