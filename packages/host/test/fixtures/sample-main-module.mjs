// 真实落盘的 main 模块产物，供 MainLoader 端到端测试 import。纯 JS、无外部依赖。
export default {
  async activate(ctx) {
    await ctx.storage.set("loaded", true);
    ctx.registerTool({
      name: "echo",
      schema: { type: "object" },
      handler: async (args) => args,
    });
    ctx.log.info("sample module up");
  },
};
