import { mutation } from "./_generated/server";

export const deleteLegacyProjects = mutation({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    let count = 0;
    for (const p of projects) {
      if ((p as any).organizationId !== undefined) {
        await ctx.db.delete(p._id);
        count++;
      }
    }
    return `Deleted ${count} legacy projects`;
  },
});
