export default {
  async activate(ctx) {
    ctx.registerTool({ name: "hi", schema: {}, handler: async () => "hi-from-b" });
  },
};
