// 纯 DOM 模块(无 React):拿 ctx.container 自行挂载,用基座发布的 bd-* 样式类。
import type { RendererContext } from "@boundary-desktop/contract";

export default {
  activate(ctx: RendererContext): void {
    ctx.container.innerHTML = '<div class="bd-empty"><h2>浏览器</h2><p>建设中</p></div>';
  },
};
