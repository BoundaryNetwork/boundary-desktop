// 模块内 scoped 样式以字符串形式 import(esbuild 的 .css text loader,见 scripts/build-modules.mjs),
// 运行时注入 <style>。给 tsc 一个 *.css 模块声明。
declare module "*.css" {
  const css: string;
  export default css;
}
