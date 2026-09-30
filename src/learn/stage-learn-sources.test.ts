import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseStageArgs, resolveRepoName, sanitizeDirName, stageLearnSources } from "./stage-learn-sources.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "stage-learn-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("sanitizeDirName", () => {
  it("normalizes unsafe characters", () => {
    expect(sanitizeDirName("Foo Bar/Baz")).toBe("foo-bar-baz");
  });
});

describe("resolveRepoName", () => {
  it("uses repo segment from owner/repo shorthand", () => {
    expect(resolveRepoName("bevibing/tutor-skills")).toBe("tutor-skills");
  });

  it("uses basename for local paths", () => {
    expect(resolveRepoName("/tmp/My Project")).toBe("my-project");
  });
});

describe("parseStageArgs", () => {
  it("parses repo, doc, file, web, context, and flags", () => {
    const parsed = parseStageArgs([
      "/tmp/out",
      "--repo",
      "bevibing/tutor-skills",
      "--local",
      "/src/agentbrew",
      "--doc",
      "Skills PRD:/tmp/prd.md",
      "--file",
      "Spec PDF:/tmp/spec.pdf",
      "--web",
      "https://example.com/guide:/tmp/guide.md",
      "--context",
      "pr-814:/tmp/pr.md",
      "--depth",
      "2",
      "--dry-run",
    ]);
    expect(parsed.outputDir).toBe("/tmp/out");
    expect(parsed.repos).toEqual(["bevibing/tutor-skills"]);
    expect(parsed.localRepos).toEqual(["/src/agentbrew"]);
    expect(parsed.docs).toEqual([{ title: "Skills PRD", sourcePath: "/tmp/prd.md" }]);
    expect(parsed.files).toEqual([{ label: "Spec PDF", sourcePath: "/tmp/spec.pdf" }]);
    expect(parsed.web).toEqual([{ url: "https://example.com/guide", sourcePath: "/tmp/guide.md" }]);
    expect(parsed.context).toEqual([{ name: "pr-814", sourcePath: "/tmp/pr.md" }]);
    expect(parsed.depth).toBe(2);
    expect(parsed.dryRun).toBe(true);
  });

  it("splits --web on the first colon so URLs keep their scheme", () => {
    const parsed = parseStageArgs(["/tmp/out", "--web", "https://x.dev/a:/tmp/a.md"]);
    expect(parsed.web).toEqual([{ url: "https://x.dev/a", sourcePath: "/tmp/a.md" }]);
  });
});

describe.sequential("stageLearnSources", () => {
  it("stages local repo, docs, and context with mixed mode", () => {
    const repoSrc = join(tmpRoot, "sample-repo");
    mkdirSync(repoSrc, { recursive: true });
    const readme = join(repoSrc, "README.md");
    const docSrc = join(tmpRoot, "note.md");
    const ctxSrc = join(tmpRoot, "issue.md");
    const out = join(tmpRoot, "staging");

    writeFileSync(readme, "# Sample\n", "utf8");
    writeFileSync(docSrc, "# Doc\n", "utf8");
    writeFileSync(ctxSrc, "# Issue\n", "utf8");
    cpSync(join(import.meta.dirname, "../../package.json"), join(repoSrc, "package.json"));

    const manifest = stageLearnSources({
      outputDir: out,
      localRepos: [repoSrc],
      docs: [{ title: "Design Doc", sourcePath: docSrc }],
      context: [{ name: "Issue 42", sourcePath: ctxSrc }],
    });

    expect(manifest.tutorSetupMode).toBe("mixed");
    expect(existsSync(join(out, "manifest.json"))).toBe(true);
    expect(existsSync(join(out, "sources/docs/design-doc.md"))).toBe(true);
    expect(existsSync(join(out, "sources/context/issue-42.md"))).toBe(true);
    expect(existsSync(join(out, "sources/docs/repos/sample-repo/README.md"))).toBe(true);
    expect(readFileSync(join(out, "sources/LEARN_PROJECT.md"), "utf8")).toContain("mixed");
  });

  it("selects codebase mode for a single local repo", () => {
    const repoSrc = join(tmpRoot, "agentbrew");
    mkdirSync(repoSrc, { recursive: true });
    writeFileSync(join(repoSrc, "README.md"), "# Agentbrew\n", "utf8");
    writeFileSync(join(repoSrc, "package.json"), "{}\n", "utf8");

    const manifest = stageLearnSources({
      outputDir: join(tmpRoot, "out-code"),
      localRepos: [repoSrc],
    });

    expect(manifest.tutorSetupMode).toBe("codebase");
    expect(manifest.tutorSetupCwd).toContain("sources/repos/agentbrew");
  });

  it("selects document mode for docs only", () => {
    const docSrc = join(tmpRoot, "only.md");
    writeFileSync(docSrc, "# Only doc\n", "utf8");

    const manifest = stageLearnSources({
      outputDir: join(tmpRoot, "out-doc"),
      docs: [{ title: "Guide", sourcePath: docSrc }],
    });

    expect(manifest.tutorSetupMode).toBe("document");
    expect(manifest.tutorSetupCwd).toMatch(/sources$/);
  });

  it("stages loose files (extension preserved) and web pages as document sources", () => {
    const pdfSrc = join(tmpRoot, "spec.pdf");
    const webSrc = join(tmpRoot, "fetched.md");
    writeFileSync(pdfSrc, "%PDF-1.4 fake\n", "utf8");
    writeFileSync(webSrc, "# Fetched page\n", "utf8");
    const out = join(tmpRoot, "out-files-web");

    const manifest = stageLearnSources({
      outputDir: out,
      files: [{ label: "Design Spec", sourcePath: pdfSrc }],
      web: [{ url: "https://example.com/guide", sourcePath: webSrc }],
    });

    expect(manifest.tutorSetupMode).toBe("document");
    expect(manifest.files).toHaveLength(1);
    expect(manifest.web).toHaveLength(1);
    expect(existsSync(join(out, "sources/files/design-spec.pdf"))).toBe(true);
    expect(existsSync(join(out, "sources/web/https-example.com-guide.md"))).toBe(true);
    expect(readFileSync(join(out, "sources/LEARN_PROJECT.md"), "utf8")).toContain("## Web");
  });

  it("treats a single repo plus a web page as mixed mode", () => {
    const repoSrc = join(tmpRoot, "solo");
    mkdirSync(repoSrc, { recursive: true });
    writeFileSync(join(repoSrc, "package.json"), "{}\n", "utf8");
    const webSrc = join(tmpRoot, "page.md");
    writeFileSync(webSrc, "# Page\n", "utf8");

    const manifest = stageLearnSources({
      outputDir: join(tmpRoot, "out-mixed-web"),
      localRepos: [repoSrc],
      web: [{ url: "https://example.com/x", sourcePath: webSrc }],
    });

    expect(manifest.tutorSetupMode).toBe("mixed");
  });

  it("records content hashes and skips unchanged docs on re-run", () => {
    const docA = join(tmpRoot, "a.md");
    const docB = join(tmpRoot, "b.md");
    writeFileSync(docA, "# Doc A\n", "utf8");
    writeFileSync(docB, "# Doc B\n", "utf8");
    const out = join(tmpRoot, "freshness-out");

    const first = stageLearnSources({
      outputDir: out,
      docs: [
        { title: "Doc A", sourcePath: docA },
        { title: "Doc B", sourcePath: docB },
      ],
    });
    expect(first.version).toBe(3);
    expect(first.docs[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.freshness.changed).toEqual(["doc:doc-a", "doc:doc-b"]);
    expect(first.freshness.unchanged).toEqual([]);

    const second = stageLearnSources({
      outputDir: out,
      docs: [
        { title: "Doc A", sourcePath: docA },
        { title: "Doc B", sourcePath: docB },
      ],
    });
    expect(second.freshness.unchanged).toEqual(["doc:doc-a", "doc:doc-b"]);
    expect(second.freshness.changed).toEqual([]);
  });

  it("re-stages only changed sources when one input file changes", () => {
    const docA = join(tmpRoot, "stable.md");
    const docB = join(tmpRoot, "mutable.md");
    writeFileSync(docA, "# Stable\n", "utf8");
    writeFileSync(docB, "# Mutable v1\n", "utf8");
    const out = join(tmpRoot, "freshness-partial");

    stageLearnSources({
      outputDir: out,
      docs: [
        { title: "Stable", sourcePath: docA },
        { title: "Mutable", sourcePath: docB },
      ],
    });

    const before = readFileSync(join(out, "sources/docs/mutable.md"), "utf8");
    writeFileSync(docB, "# Mutable v2\n", "utf8");

    const second = stageLearnSources({
      outputDir: out,
      docs: [
        { title: "Stable", sourcePath: docA },
        { title: "Mutable", sourcePath: docB },
      ],
    });

    expect(second.freshness.unchanged).toEqual(["doc:stable"]);
    expect(second.freshness.changed).toEqual(["doc:mutable"]);
    const after = readFileSync(join(out, "sources/docs/mutable.md"), "utf8");
    expect(before).toContain("v1");
    expect(after).toContain("v2");
  });
});
