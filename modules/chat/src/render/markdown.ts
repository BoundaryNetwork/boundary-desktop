// 把 assistant 文本渲染成经 DOMPurify 清洗的 HTML。
// 移植自 agent-ui src/lib/markdown.ts(逐字搬:仅依赖 marked + dompurify,无内部依赖)。
// 去掉 highlight.js:代码块呈等宽无高亮。

import DOMPurify from "dompurify";
import { marked, Renderer } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true,
});

// 代码块右上角复制按钮:基底渲染器产出 <pre><code>,再包 .oc-code-block(含 .oc-code-copy 按钮)。
// 点击行为由 ui/line.tsx 事件委托处理;此处只产出静态 HTML。仅覆盖块级 code。
// 按钮内不放内容(DOMPurify html profile 不含 svg);图标由 CSS mask 画,aria-label 兜无障碍。
const baseRenderer = new Renderer();

marked.use({
  renderer: {
    code(token) {
      const inner = baseRenderer.code(token);
      return `<div class="oc-code-block"><button class="oc-code-copy" type="button" aria-label="复制代码"></button>${inner}</div>`;
    },
  },
});

// 图片安全:仅放行 https:// 与内联 data:image/...。阻断 http:// 追踪像素与协议注入。
const SAFE_IMG_SRC = /^(https:\/\/|data:image\/(png|jpe?g|gif|webp|svg\+xml|avif);)/i;
const SAFE_EXTERNAL_HREF = /^(https?:|mailto:)/i;

DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName === "src" && _node.nodeName === "IMG") {
    if (!SAFE_IMG_SRC.test(data.attrValue)) data.keepAttr = false;
  }
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName === "A") {
    const el = node as Element;
    const href = el.getAttribute("href") ?? "";
    if (SAFE_EXTERNAL_HREF.test(href)) {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
      el.setAttribute("referrerpolicy", "no-referrer");
    } else if (href && !href.startsWith("#")) {
      el.removeAttribute("href");
    }
    return;
  }

  if (node.nodeName !== "IMG") return;
  const el = node as Element;
  if (!el.getAttribute("src")) {
    el.parentNode?.removeChild(el);
    return;
  }
  el.setAttribute("loading", "lazy");
  el.setAttribute("decoding", "async");
  el.setAttribute("referrerpolicy", "no-referrer");
});

export function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel", "loading", "decoding", "referrerpolicy"],
    RETURN_TRUSTED_TYPE: false,
  }) as string;
}

export function renderMarkdownInline(text: string): string {
  const raw = marked.parseInline(text, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel", "loading", "decoding", "referrerpolicy"],
    RETURN_TRUSTED_TYPE: false,
  }) as string;
}
