/**
 * Write a new JSON value back into a config file's existing text, changing
 * only the parts that differ.
 *
 * `JSON.stringify` of a parsed file rewrites every value the person wrote:
 * `\u000a` becomes `\n`, `\/` becomes `/`, `\u2192` becomes `→`, and
 * one-line arrays are spread over many lines. Sync writes shared files such
 * as `~/.claude/settings.json`, so it must not touch the person's own text.
 * This module edits the original text path by path (offsets from
 * `jsonc-parser`), so unchanged values keep their exact bytes. New values
 * use two-space JSON, indented to match their neighbours.
 */
import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { findNodeAtLocation, type Node, type ParseError, parse, parseTree } from "jsonc-parser";

type JsonPath = (string | number)[];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Parse strict JSON; undefined when the text is not valid JSON. */
function parseStrict(text: string): unknown {
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: false, disallowComments: true });
  return errors.length === 0 ? value : undefined;
}

const nodeEnd = (node: Node): number => node.offset + node.length;

/** Edits JSON text in place. Each edit re-parses, so offsets stay correct. */
class TextEditor {
  constructor(
    public text: string,
    private readonly eol: string,
  ) {}

  private node(path: JsonPath): Node {
    const root = parseTree(this.text);
    const node = root && findNodeAtLocation(root, path);
    if (!node) throw new Error(`no JSON node at ${path.join(".")}`);
    return node;
  }

  private splice(start: number, end: number, insert: string): void {
    this.text = this.text.slice(0, start) + insert + this.text.slice(end);
  }

  /** Leading whitespace of the line that holds `offset`. */
  private indentAt(offset: number): string {
    const lineStart = this.text.lastIndexOf("\n", offset - 1) + 1;
    return /^[ \t]*/u.exec(this.text.slice(lineStart))?.[0] ?? "";
  }

  private onOwnLine(offset: number): boolean {
    const lineStart = this.text.lastIndexOf("\n", offset - 1) + 1;
    return this.text.slice(lineStart, offset).trim() === "";
  }

  private render(value: unknown, indent: string): string {
    return JSON.stringify(value, null, 2)
      .split("\n")
      .join(this.eol + indent);
  }

  private replace(path: JsonPath, value: unknown): void {
    const node = this.node(path);
    this.splice(node.offset, nodeEnd(node), this.render(value, this.indentAt(node.offset)));
  }

  /** Remove an object member or array item together with one comma. */
  private remove(path: JsonPath): void {
    const value = this.node(path);
    const item = value.parent?.type === "property" ? value.parent : value;
    const container = item.parent;
    if (!container?.children) throw new Error(`no container at ${path.join(".")}`);
    const siblings = container.children;
    const index = siblings.indexOf(item);
    if (index > 0) this.splice(nodeEnd(siblings[index - 1]), nodeEnd(item), "");
    else if (siblings.length > 1) this.splice(item.offset, siblings[1].offset, "");
    else this.splice(container.offset + 1, nodeEnd(container) - 1, "");
  }

  /** Append an object member (`key` set) or array item after the last child. */
  private append(parentPath: JsonPath, key: string | undefined, value: unknown): void {
    const parent = this.node(parentPath);
    const last = parent.children?.at(-1);
    const prefix = key === undefined ? "" : `${JSON.stringify(key)}: `;
    if (!last) {
      const whole = key === undefined ? [value] : { [key]: value };
      this.splice(parent.offset, nodeEnd(parent), this.render(whole, this.indentAt(parent.offset)));
    } else if (this.onOwnLine(last.offset)) {
      const indent = this.indentAt(last.offset);
      this.splice(nodeEnd(last), nodeEnd(last), `,${this.eol}${indent}${prefix}${this.render(value, indent)}`);
    } else {
      this.splice(nodeEnd(last), nodeEnd(last), `, ${prefix}${JSON.stringify(value)}`);
    }
  }

  update(path: JsonPath, before: unknown, after: unknown): void {
    if (isDeepStrictEqual(before, after)) return;
    if (isPlainObject(before) && isPlainObject(after)) {
      this.updateObject(path, before, after);
    } else if (Array.isArray(before) && Array.isArray(after)) {
      this.updateArray(path, before, after);
    } else {
      this.replace(path, after);
    }
  }

  private updateObject(path: JsonPath, before: Record<string, unknown>, after: Record<string, unknown>): void {
    for (const key of Object.keys(before)) {
      if (!Object.hasOwn(after, key)) this.remove([...path, key]);
    }
    for (const [key, value] of Object.entries(after)) {
      if (Object.hasOwn(before, key)) this.update([...path, key], before[key], value);
      else this.append(path, key, value);
    }
  }

  /**
   * Same length: edit item by item. Otherwise remove the old items that are
   * gone, then edit or append item by item.
   */
  private updateArray(path: JsonPath, before: unknown[], after: unknown[]): void {
    const kept = [...before];
    if (kept.length !== after.length) this.removeGone(path, kept, after);
    after.forEach((item, i) => {
      if (i < kept.length) this.update([...path, i], kept[i], item);
      else this.append(path, undefined, item);
    });
  }

  private removeGone(path: JsonPath, kept: unknown[], after: unknown[]): void {
    for (let i = kept.length - 1; i >= 0; i--) {
      if (!after.some((item) => isDeepStrictEqual(item, kept[i]))) {
        this.remove([...path, i]);
        kept.splice(i, 1);
      }
    }
    for (let i = kept.length - 1; i >= after.length; i--) {
      this.remove([...path, i]);
      kept.pop();
    }
  }
}

/**
 * Return the text for `next`, reusing `originalText` for every unchanged
 * value. Falls back to plain `JSON.stringify` when there is no original
 * text, the original is not valid JSON, or the edit does not round-trip.
 */
export function jsonTextFor(originalText: string | undefined, next: unknown): string {
  if (originalText === undefined || originalText.trim() === "") return serialize(next);
  const before = parseStrict(originalText);
  if (!isPlainObject(before) || !isPlainObject(next)) return serialize(next);
  const eol = originalText.includes("\r\n") ? "\r\n" : "\n";
  const editor = new TextEditor(originalText, eol);
  try {
    editor.update([], before, next);
  } catch {
    return serialize(next);
  }
  return isDeepStrictEqual(parseStrict(editor.text), next) ? editor.text : serialize(next);
}

/** The file's current text, or undefined when it is missing or unreadable. */
export function existingText(filePath: string): string | undefined {
  try {
    return existsSync(filePath) ? readFileSync(filePath, "utf-8") : undefined;
  } catch {
    return undefined;
  }
}
