import { parseTree } from "jsonc-parser";

const schema = {
  type: "object",
  properties: { action: { type: "string", enum: ["EDIT", "POST", "HOLD"] } },
  required: ["action"],
  additionalProperties: false,
};

export async function requestDecision(prompt, transport) {
  try {
    if (typeof prompt !== "string" || typeof transport !== "function") throw new Error();
    const response = await transport("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "qwen3:4b",
        stream: false,
        think: false,
        options: { temperature: 0 },
        format: schema,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) throw new Error();
    const envelope = JSON.parse(await response.text());
    const content = envelope?.message?.content;
    if (typeof content !== "string") throw new Error();
    const errors = [];
    const root = parseTree(content, errors, { disallowComments: true, allowTrailingComma: false });
    if (errors.length || root?.type !== "object" || root.children?.length !== 1) throw new Error();
    const [key, value] = root.children[0].children ?? [];
    if (
      key?.type !== "string" ||
      key.value !== "action" ||
      value?.type !== "string" ||
      !["EDIT", "POST", "HOLD"].includes(value.value)
    )
      throw new Error();
    return value.value;
  } catch {
    throw new Error("Chat decision response unavailable");
  }
}
