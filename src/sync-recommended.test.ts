import { describe, expect, it } from "vitest";
import { shouldInstallRecommendedOnSync } from "./sync-recommended.js";

const GLOBAL = "/fixture/home/.config/agentbrew";
const CWD = "/fixture/project";
const existsOnly =
  (...paths: string[]) =>
  (p: string) =>
    paths.includes(p);

describe("shouldInstallRecommendedOnSync", () => {
  it("installs recommended on a machine with no Agentfile (first-run contract)", () => {
    expect(shouldInstallRecommendedOnSync({}, { cwd: CWD, globalDir: GLOBAL, exists: existsOnly() })).toBe(true);
  });

  it("skips when the global Agentfile exists: the Agentfile decides via its own `recommended` key", () => {
    const exists = existsOnly(`${GLOBAL}/Agentfile.yaml`);
    expect(shouldInstallRecommendedOnSync({}, { cwd: CWD, globalDir: GLOBAL, exists })).toBe(false);
  });

  it("skips when a project Agentfile exists in cwd", () => {
    const exists = existsOnly(`${CWD}/Agentfile.yml`);
    expect(shouldInstallRecommendedOnSync({}, { cwd: CWD, globalDir: GLOBAL, exists })).toBe(false);
  });

  it("skips when --agentfile is passed", () => {
    expect(
      shouldInstallRecommendedOnSync(
        { agentfile: "/x/Agentfile.yaml" },
        { cwd: CWD, globalDir: GLOBAL, exists: existsOnly() },
      ),
    ).toBe(false);
  });

  it("skips for --no-recommended, --only, and --dry-run", () => {
    const deps = { cwd: CWD, globalDir: GLOBAL, exists: existsOnly() };
    expect(shouldInstallRecommendedOnSync({ recommended: false }, deps)).toBe(false);
    expect(shouldInstallRecommendedOnSync({ only: "skills" }, deps)).toBe(false);
    expect(shouldInstallRecommendedOnSync({ dryRun: true }, deps)).toBe(false);
  });
});
