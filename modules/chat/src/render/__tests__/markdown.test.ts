import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../markdown";

describe("renderMarkdown sanitize", () => {
  it("渲染基础 markdown", () => {
    const html = renderMarkdown("**bold** and `code`");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("剥离 <script>", () => {
    const html = renderMarkdown("hi<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(1)");
  });

  it("javascript: 链接被移除 href", () => {
    const html = renderMarkdown("[x](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("https 外链加 target/rel", () => {
    const html = renderMarkdown("[x](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("http 图片被剥 src 后移除", () => {
    const html = renderMarkdown("![a](http://tracker.test/p.gif)");
    expect(html).not.toContain("tracker.test");
  });

  it("代码块包 .oc-code-block 复制按钮", () => {
    const html = renderMarkdown("```\nconst x = 1\n```");
    expect(html).toContain("oc-code-block");
    expect(html).toContain("oc-code-copy");
  });
});
