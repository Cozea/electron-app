import { defineDevAppExtension } from "@cozea/devapp-api/extension";

export default defineDevAppExtension({
  activate(context) {
    context.subscriptions.add(
      context.commands.register("counter.reset", async () => ({ count: 0 })),
    );
  },
});
