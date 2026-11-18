// Agentbrew appends this adapter to claude-hooks.js for OpenCode 2.
function claimOpenCodeSessionEvent(event, directory, ownedSessions) {
  const id = event.data?.sessionID;
  if (typeof id !== "string" || id.length === 0) return;
  const location = event.location?.directory ?? event.data?.location?.directory;
  if (event.type === "session.created" && location === directory && !ownedSessions.has(id)) {
    ownedSessions.add(id);
    return id;
  }
  if (event.type === "session.deleted" && (location === undefined || location === directory)) {
    if (ownedSessions.delete(id)) return id;
  }
}

export default {
  id: "agentbrew.claude-hooks",
  async setup(ctx) {
    const { directory } = ctx.location;
    const bridge = await ClaudeHooks({ directory });

    await ctx.tool.hook("execute.before", async ({ sessionID, tool, input }) => {
      await bridge["tool.execute.before"]({ sessionID, tool }, { args: input });
    });
    await ctx.session.hook("prompt", async (event) => {
      const part = { type: "text", text: event.prompt.text };
      await bridge["chat.message"]({ sessionID: event.sessionID }, { parts: [part] });
      event.prompt.text = part.text;
    });
    await ctx.tool.hook("execute.after", async (event) => {
      if (event.status !== "completed") return;
      const content = event.result.content;
      const parts = typeof content === "string" ? [{ type: "text", text: content }] : (content ?? []);
      const original = parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      const result = { output: original };
      await bridge["tool.execute.after"]({ sessionID: event.sessionID, tool: event.tool, args: event.input }, result);
      if (result.output !== original) {
        const feedback = { type: "text", text: result.output.slice(original.length) };
        event.result = { ...event.result, content: [...parts, feedback] };
      }
    });

    // Session ownership belongs to this plugin instance. Consume it on delete.
    // OpenCode can omit the directory on its deletion event.
    const ownedSessions = new Set();
    const controller = new AbortController();
    const events = ctx.event
      .subscribe({
        types: ["session.created", "session.deleted"],
        signal: controller.signal,
      })
      [Symbol.asyncIterator]();
    const first = events.next();
    void (async () => {
      for (let current = await first; !current.done; current = await events.next()) {
        const event = current.value;
        const id = claimOpenCodeSessionEvent(event, directory, ownedSessions);
        if (id) await bridge.event({ event: { type: event.type, properties: { info: { id } } } });
      }
    })().catch(() => {
      if (!controller.signal.aborted) console.error("Agentbrew: OpenCode hook event stream stopped");
    });

    return () => {
      controller.abort();
      ownedSessions.clear();
    };
  },
};
