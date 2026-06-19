import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PageTabs, PageTabsList, PageTabsTrigger, PageTabsContent } from "../page-tabs";

describe("PageTabs", () => {
  it("renders tabs with multiple triggers and content sections", () => {
    render(
      <PageTabs defaultValue="tab1">
        <PageTabsList>
          <PageTabsTrigger value="tab1">Tab 1</PageTabsTrigger>
          <PageTabsTrigger value="tab2">Tab 2</PageTabsTrigger>
        </PageTabsList>
        <PageTabsContent value="tab1">Content 1</PageTabsContent>
        <PageTabsContent value="tab2">Content 2</PageTabsContent>
      </PageTabs>
    );
    expect(screen.getByText("Tab 1")).toBeInTheDocument();
    expect(screen.getByText("Tab 2")).toBeInTheDocument();
  });

  it("displays the default tab content", () => {
    render(
      <PageTabs defaultValue="tab1">
        <PageTabsList>
          <PageTabsTrigger value="tab1">Tab 1</PageTabsTrigger>
          <PageTabsTrigger value="tab2">Tab 2</PageTabsTrigger>
        </PageTabsList>
        <PageTabsContent value="tab1">Content 1</PageTabsContent>
        <PageTabsContent value="tab2">Content 2</PageTabsContent>
      </PageTabs>
    );
    expect(screen.getByText("Content 1")).toBeInTheDocument();
  });

  it("displays the default tab content correctly", () => {
    render(
      <PageTabs defaultValue="tab1">
        <PageTabsList>
          <PageTabsTrigger value="tab1">Tab 1</PageTabsTrigger>
          <PageTabsTrigger value="tab2">Tab 2</PageTabsTrigger>
        </PageTabsList>
        <PageTabsContent value="tab1">Content 1</PageTabsContent>
        <PageTabsContent value="tab2">Content 2</PageTabsContent>
      </PageTabs>
    );
    expect(screen.getByText("Content 1")).toBeInTheDocument();
  });

  it("marks the active tab trigger with correct data-state", () => {
    render(
      <PageTabs defaultValue="tab1">
        <PageTabsList>
          <PageTabsTrigger value="tab1">Tab 1</PageTabsTrigger>
          <PageTabsTrigger value="tab2">Tab 2</PageTabsTrigger>
        </PageTabsList>
        <PageTabsContent value="tab1">Content 1</PageTabsContent>
        <PageTabsContent value="tab2">Content 2</PageTabsContent>
      </PageTabs>
    );
    const tab1 = screen.getByText("Tab 1");
    const tab2 = screen.getByText("Tab 2");
    expect(tab1).toHaveAttribute("data-state", "active");
    expect(tab2).toHaveAttribute("data-state", "inactive");
  });

  it("allows custom className on PageTabsList", () => {
    const { container } = render(
      <PageTabs defaultValue="tab1">
        <PageTabsList className="custom-list-class">
          <PageTabsTrigger value="tab1">Tab 1</PageTabsTrigger>
        </PageTabsList>
        <PageTabsContent value="tab1">Content 1</PageTabsContent>
      </PageTabs>
    );
    const list = container.querySelector(".custom-list-class");
    expect(list).toBeInTheDocument();
  });

  it("allows custom className on PageTabsTrigger", () => {
    const { container } = render(
      <PageTabs defaultValue="tab1">
        <PageTabsList>
          <PageTabsTrigger value="tab1" className="custom-trigger-class">
            Tab 1
          </PageTabsTrigger>
        </PageTabsList>
        <PageTabsContent value="tab1">Content 1</PageTabsContent>
      </PageTabs>
    );
    const trigger = container.querySelector(".custom-trigger-class");
    expect(trigger).toBeInTheDocument();
  });

  it("allows custom className on PageTabsContent", () => {
    const { container } = render(
      <PageTabs defaultValue="tab1">
        <PageTabsList>
          <PageTabsTrigger value="tab1">Tab 1</PageTabsTrigger>
        </PageTabsList>
        <PageTabsContent value="tab1" className="custom-content-class">
          Content 1
        </PageTabsContent>
      </PageTabs>
    );
    const content = container.querySelector(".custom-content-class");
    expect(content).toBeInTheDocument();
  });
});
