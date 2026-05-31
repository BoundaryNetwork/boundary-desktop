// main-runtime 模块:浏览器能力自包含在模块内(view / CDP / 自动化随后补)。
// 当前为 surface 跑通的最小骨架——创建一个 native WebContentsView,经 ctx.surface 挂到框架
// 分配的右侧区域、铺满并跟随 resize/前台显隐;deactivate 时销毁自己的 view(框架只摘窗口)。
import { WebContentsView } from "electron";
import { defineModule, type MainContext } from "@boundary-desktop/contract";

// surface 跑通阶段的落地页(tab 管理 / 自动化建设中)。后续由模块自己的 chrome 页接管。
const PLACEHOLDER =
  "data:text/html," +
  encodeURIComponent(
    '<!doctype html><meta charset="utf-8">' +
      '<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#888">' +
      "浏览器模块：surface 已就绪（tab 管理 / 自动化建设中）</body>",
  );

let view: WebContentsView | null = null;

export default defineModule<MainContext>({
  async activate(ctx) {
    const surface = ctx.surface;
    if (!surface) throw new Error("browser 模块需要框架分配 UI 区域(MainContext.surface)");

    view = new WebContentsView();
    surface.attach(view); // 句柄由 ctx 自动 track,deactivate 时框架把 view 从窗口摘除
    await view.webContents.loadURL(PLACEHOLDER);
    ctx.log.info("browser surface 已挂载");
  },

  deactivate() {
    // 模块持有 view 的生命周期:销毁 webContents(框架只负责把它从窗口摘掉)。
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
    view = null;
  },
});
