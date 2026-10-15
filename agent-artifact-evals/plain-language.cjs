// Deterministic plain-language checks for sampled agent output.
// Heuristics only: no model call, no network. Thresholds follow ASD-STE100
// (20 words for procedures, 25 for descriptions) and the global rule in
// docs/shared-rules.md.

const SURFACES = ["chat", "docs", "pr", "code-comment", "skill-wrapper"];

const LIMITS = {
  sentenceWords: 25,
  paragraphSentences: 4,
  passiveShare: 0.2,
  commentBlockLines: 3,
};

// Each diagnostic names the rule text it enforces, so a failure shows the gap.
const RULE_GAPS = {
  "long-sentence": "short, direct sentences",
  "passive-voice": "active voice",
  "long-paragraph": "short paragraphs",
  "answer-not-first": "put the answer first",
  "pr-summary-not-first": "PR bodies open with ## Summary",
  "long-comment": "add a code comment only when it clarifies the code",
};

const FILLER_OPENERS =
  /^(sure|certainly|of course|great question|absolutely|okay|ok|so|well|let me|i'll|i will|i am going to|i'm going to|as an ai)\b/i;

const PASSIVE =
  /\b(?:is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(?:\w+ed|known|made|done|given|taken|shown|written|seen|built|kept|found|run|set|sent|held|left|put|read|told)\b/i;

function stripFencedCode(text) {
  return text.replace(/```[\s\S]*?```/g, "");
}

function stripFrontmatter(text) {
  return text.replace(/^---\n[\s\S]*?\n---\n/, "");
}

/** Prose paragraphs: drop code fences, headings, tables, and blank lines. */
function proseParagraphs(text) {
  return stripFencedCode(text)
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split("\n")
        .filter((line) => !/^\s*(#|\||<!--)/.test(line))
        .join(" ")
        .trim(),
    )
    .filter((block) => block.length > 0);
}

/** Split a paragraph or bullet list into sentences. Each bullet is its own unit. */
function sentencesOf(paragraph) {
  return paragraph
    .split(/(?:^|\s)[-*]\s+|(?:^|\s)\d+\.\s+/)
    .flatMap((item) => item.split(/(?<=[.!?])\s+(?=[A-Z`"(])/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => /[A-Za-z]/.test(sentence));
}

function wordCount(sentence) {
  return sentence.replace(/`[^`]*`/g, "code").split(/\s+/).filter(Boolean).length;
}

function checkSentences(paragraphs, diagnostics) {
  const sentences = paragraphs.flatMap(sentencesOf);
  for (const sentence of sentences) {
    const words = wordCount(sentence);
    if (words > LIMITS.sentenceWords) {
      diagnostics.push({ id: "long-sentence", detail: `${words} words: "${sentence.slice(0, 60)}..."` });
    }
  }
  const passive = sentences.filter((sentence) => PASSIVE.test(sentence.replace(/`[^`]*`/g, "")));
  if (sentences.length > 0 && passive.length / sentences.length > LIMITS.passiveShare) {
    diagnostics.push({
      id: "passive-voice",
      detail: `${passive.length} of ${sentences.length} sentences are passive`,
    });
  }
}

function checkParagraphs(paragraphs, diagnostics) {
  for (const paragraph of paragraphs) {
    const isList = /(^|\s)([-*]|\d+\.)\s/.test(paragraph);
    const count = sentencesOf(paragraph).length;
    if (!isList && count > LIMITS.paragraphSentences) {
      diagnostics.push({ id: "long-paragraph", detail: `${count} sentences in one paragraph` });
    }
  }
}

function checkAnswerFirst(paragraphs, diagnostics) {
  const first = paragraphs[0] || "";
  if (FILLER_OPENERS.test(first)) {
    diagnostics.push({ id: "answer-not-first", detail: `opens with "${first.split(/\s+/).slice(0, 4).join(" ")}"` });
  }
}

function checkPrSummary(text, diagnostics) {
  const firstLine = text.split("\n").find((line) => line.trim().length > 0) || "";
  if (firstLine.trim() !== "## Summary") {
    diagnostics.push({ id: "pr-summary-not-first", detail: `first line is "${firstLine.trim().slice(0, 40)}"` });
  }
}

/** Group consecutive comment lines (// or #) and /* *\/ blocks into comment blocks. */
function commentBlocks(code) {
  const blocks = [];
  let current = [];
  const flush = () => {
    if (current.length > 0) blocks.push(current);
    current = [];
  };
  for (const line of code.split("\n")) {
    const match = line.match(/^\s*(?:\/\/|#(?!!)|\/\*+|\*(?!\/))\s?(.*?)(?:\*\/)?\s*$/);
    if (match && !/^\s*\*\/\s*$/.test(line)) {
      if (match[1].trim().length > 0) current.push(match[1].trim());
    } else {
      flush();
    }
  }
  flush();
  return blocks;
}

function checkComments(text, diagnostics) {
  const blocks = commentBlocks(text);
  for (const block of blocks) {
    if (block.length > LIMITS.commentBlockLines) {
      diagnostics.push({ id: "long-comment", detail: `${block.length}-line comment block` });
    }
  }
  checkSentences(blocks.map((block) => block.join(" ")), diagnostics);
}

function diagnosticsFor(surface, text) {
  const diagnostics = [];
  if (surface === "code-comment") {
    checkComments(text, diagnostics);
    return diagnostics;
  }
  const body = surface === "skill-wrapper" ? stripFrontmatter(text) : text;
  const paragraphs = proseParagraphs(body);
  if (surface === "pr") checkPrSummary(text, diagnostics);
  if (surface === "chat" || surface === "docs") checkAnswerFirst(paragraphs, diagnostics);
  checkSentences(paragraphs, diagnostics);
  checkParagraphs(paragraphs, diagnostics);
  return diagnostics;
}

/** Evaluate one sampled output. Returns the same PASS/FAIL text shape as provider.cjs. */
function evaluatePlainLanguage({ artifactPath, surface, text }) {
  if (!SURFACES.includes(surface)) {
    throw new Error(`unknown plain-language surface "${surface}" (expected one of: ${SURFACES.join(", ")})`);
  }
  const diagnostics = diagnosticsFor(surface, text);
  const status = diagnostics.length === 0 ? "PASS" : "FAIL";
  const lines = [`${status} ${artifactPath}`, `surface=${surface}`, `diagnostic_count=${diagnostics.length}`];
  for (const diagnostic of diagnostics) {
    lines.push(`diagnostic ${diagnostic.id} rule="${RULE_GAPS[diagnostic.id]}" ${diagnostic.detail}`);
  }
  return { status, diagnostics, output: lines.join("\n") };
}

module.exports = { evaluatePlainLanguage, LIMITS, RULE_GAPS, SURFACES };
