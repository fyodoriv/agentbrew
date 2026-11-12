import { execFileSync, spawnSync } from "node:child_process";
import fs, {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cargoProducer } from "./test-utils/cargo-producers.js";

const source = resolve(import.meta.dirname, "..");
const native = await import(new URL("../scripts/native-build-tools.mjs", import.meta.url).href);
const builder = await import(new URL("../scripts/build-native-prebuilt.mjs", import.meta.url).href);
const roots: string[] = [];

function producerDiagnostic(
  stderr: string,
  env: NodeJS.ProcessEnv,
  probe: () => { insideFixture: boolean; deps: string; build: string; fingerprint: string },
) {
  try {
    const { insideFixture, deps, build, fingerprint } = probe();
    return {
      available: true,
      cargoPathInsideFixtureLexical: insideFixture,
      version: "unknown",
      compileTextPresent: /Compiling checkup-run\b/.test(stderr),
      finishedTextPresent: /Finished `release` profile/.test(stderr),
      deps,
      build,
      fingerprint,
      buildDirOverridePresent: ["CARGO_BUILD_BUILD_DIR", "CARGO_BUILD_TARGET_DIR", "CARGO_TARGET_DIR"].some(
        (key) => key in env,
      ),
    };
  } catch {
    return { available: false };
  }
}

function producerProbe(cargo: string, root: string, release: string) {
  const kind = (name: string) => {
    try {
      const stat = fs.lstatSync(join(release, name));
      return stat.isDirectory() ? "directory" : "other";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
      throw error;
    }
  };
  const rel = relative(root, cargo);
  return {
    insideFixture: rel !== ".." && !rel.startsWith("../") && !rel.startsWith("/"),
    deps: kind("deps"),
    build: kind("build"),
    fingerprint: kind(".fingerprint"),
  };
}

function producerPath(
  release: string,
  original: Buffer,
  root: string,
  final: string | undefined,
  diagnostic: () => object,
  emit: (text: string) => void,
) {
  try {
    return cargoProducer(release, original, root, final);
  } catch (error) {
    emit(`CARGO_PRODUCER_DIAGNOSTIC=${JSON.stringify(diagnostic())}`);
    throw error;
  }
}

describe("producer diagnostic", () => {
  it.each(["missing", "directory", "other"])("reports the %s layout as a closed category", (kind) => {
    const diagnostic = producerDiagnostic("Compiling checkup-run", {}, () => ({
      insideFixture: false,
      deps: kind,
      build: "missing",
      fingerprint: "missing",
    }));
    expect(diagnostic).toMatchObject({ available: true, deps: kind, cargoPathInsideFixtureLexical: false });
    expect(JSON.stringify(diagnostic)).not.toContain("Compiling checkup-run");
  });

  it("keeps the missing-producer failure when the safe probe fails", () => {
    const release = realpathSync(mkdtempSync(join(tmpdir(), "cargo-diagnostic-")));
    roots.push(release);
    const output: string[] = [];
    const diag = () =>
      producerDiagnostic("private-canary", { CARGO_TARGET_DIR: "private-canary" }, () => {
        throw new Error("private-canary");
      });
    expect.assertions(4);
    try {
      producerPath(release, Buffer.from("original"), release, undefined, diag, (text) => output.push(text));
    } catch (error) {
      expect(error).toMatchObject({ message: "expected exactly one matching producer" });
    }
    expect(output).toEqual(['CARGO_PRODUCER_DIAGNOSTIC={"available":false}']);
    expect(output.join()).not.toContain("private-canary");
    expect(producerProbe(join(release, "cargo"), release, release)).toMatchObject({
      insideFixture: true,
      deps: "missing",
    });
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ab-source-capability-")));
  roots.push(root);
  const bin = join(root, "bin");
  const home = join(root, "home");
  mkdirSync(bin);
  mkdirSync(home);
  cpSync(join(source, "scripts"), join(root, "scripts"), { recursive: true });
  cpSync(join(source, "rust/checkup-run"), join(root, "rust/checkup-run"), {
    recursive: true,
    filter: (path) => !path.split("/").includes("target"),
  });
  if (existsSync(join(source, "native/checkup-run")))
    cpSync(join(source, "native/checkup-run"), join(root, "native/checkup-run"), { recursive: true });
  const directory = join(root, "native/checkup-run/darwin-arm64");
  if (existsSync(join(directory, "manifest.json"))) {
    const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
    manifest.inputs = native.inputs(root);
    writeFileSync(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  writeFileSync(join(root, "package.json"), '{"version":"1.0.0"}\n');
  // Only the test loader hides installed toolchains; production has no override.
  writeFileSync(
    join(root, "no-cargo.mjs"),
    `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
const original=fs.accessSync;fs.accessSync=(path,...args)=>{if(/^(?:\\/opt\\/homebrew|\\/usr\\/local)\\//.test(String(path))&&/\\/(?:cargo|rustc)$/.test(String(path))){const e=new Error('absent fixture toolchain');e.code='ENOENT';throw e;}return original(path,...args);};syncBuiltinESMExports();\n`,
  );
  const sdkHostCalls = join(root, "sdk-host-calls.jsonl");
  // This mutable builtin override belongs only to each generated fixture Node child.
  writeFileSync(
    join(root, "sdk-fixture.mjs"),
    `
import cp from 'node:child_process';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const hostExec = cp.execFileSync;
const replies = new Map([
  [JSON.stringify(['/usr/bin/clang',['--version']]), 'clang fixture\\n'],
  [JSON.stringify(['/usr/bin/xcrun',['--sdk','macosx','--show-sdk-version']]), 'sdk fixture\\n'],
  [JSON.stringify(['/usr/bin/xcrun',['--sdk','macosx','ld','-version_details']]), JSON.stringify({version:'ld fixture'}) + '\\n'],
]);
cp.execFileSync = (file, args, options) => {
  const reply = replies.get(JSON.stringify([file,args]));
  if (reply !== undefined && fs.existsSync(${JSON.stringify(join(home, ".cargo/bin/cargo"))})) return options?.encoding ? reply : Buffer.from(reply);
  if (file === '/usr/bin/clang' || file === '/usr/bin/xcrun') {
    fs.appendFileSync(${JSON.stringify(sdkHostCalls)}, JSON.stringify({file,args}) + '\\n');
    throw Object.assign(new Error('Host SDK unavailable in fixture'), {code:'ENOENT'});
  }
  return hostExec(file,args,options);
};
syncBuiltinESMExports();
`,
  );
  writeFileSync(
    join(bin, "node"),
    `#!/bin/bash\nexec '${process.execPath}' --import '${join(root, "no-cargo.mjs")}' --import '${join(root, "sdk-fixture.mjs")}' "$@"\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, "uname"), '#!/bin/bash\nif [[ "$1" == -s ]]; then echo Darwin; else echo arm64; fi\n', {
    mode: 0o755,
  });
  writeFileSync(
    join(bin, "tsup"),
    `#!/bin/bash
set -eu
out="\${AGENTBREW_BUILD_OUT_DIR:-dist}"
mkdir -p "$out"
printf '%s\\n' 'console.log(process.argv.includes("--json") ? JSON.stringify({status:"missing"}) : "1.0.0");' > "$out/cli.js"
printf '%s\\n' '{"commit":"fixture"}' > "$out/build-info.json"
if [[ -f .fixture-compile-failure ]]; then exit 73; fi
if [[ -f native/checkup-run/darwin-arm64/checkup-run ]]; then
 mkdir -p "$out/native/darwin-arm64"
 cp native/checkup-run/darwin-arm64/checkup-run "$out/native/darwin-arm64/checkup-run"
fi
`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${bin}:/usr/bin:/bin`,
    BASH_ENV: "",
    ENV: "",
    NODE_OPTIONS: "",
    NODE_PATH: "",
  };
  for (const key of ["AGENTBREW_BUILD_OUT_DIR", "CARGO", "RUSTC", "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS"])
    delete env[key as keyof typeof env];
  const git = (...args: string[]) => spawnSync("/usr/bin/git", args, { cwd: root, env, encoding: "utf8" });
  git("init", "--quiet");
  git("add", ".");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "commit", "-qm", "fixture");
  const run = (script: string) => spawnSync("/bin/bash", [script], { cwd: root, env, encoding: "utf8" });
  return { root, env, bin, directory, run, sdkHostCalls };
}

function installedCargoFixture(f: ReturnType<typeof fixture>) {
  const tools = join(f.env.HOME, ".cargo/bin");
  mkdirSync(tools, { recursive: true });
  writeFileSync(join(tools, "rustc"), '#!/bin/bash\necho "rustc fixture"\n', { mode: 0o755 });
  writeFileSync(
    join(tools, "cargo"),
    `#!/bin/bash
if [[ "$1" == --version ]]; then echo 'cargo fixture'; exit 0; fi
if [[ -f .fixture-cargo-link-failure ]]; then echo 'ld: tapi error: malformed file' >&2; exit 65; fi
rustc --version > compiler-observed
target=rust/checkup-run/target
while [[ $# -gt 0 ]]; do
 if [[ "$1" == --target-dir ]]; then target="$2"; shift; fi
 shift
done
mkdir -p "$target/aarch64-apple-darwin/release"
cp native/checkup-run/darwin-arm64/checkup-run native/checkup-run/darwin-arm64/publish-dist "$target/aarch64-apple-darwin/release/"
`,
    { mode: 0o755 },
  );
}

describe.runIf(process.platform === "darwin" && process.arch === "arm64")("source native capability", () => {
  it("accepts a cold source prebuild without Cargo through the fixed qualified pair", () => {
    const f = fixture();
    const result = f.run("scripts/build-checkup-run.sh");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/prebuilt/i);
  });
  it("publishes the Cargo-free staged CLI without borrowing stale target executables", () => {
    const f = fixture();
    const result = f.run("scripts/build-source.sh");
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(f.root, "dist/cli.js"), "utf8")).toContain("console.log");
  });
  it("falls back to the verified prebuilt pair when the installed Cargo linker fails", () => {
    const f = fixture();
    installedCargoFixture(f);
    writeFileSync(join(f.root, ".fixture-cargo-link-failure"), "unreadable SDK\n");
    const prebuild = f.run("scripts/build-checkup-run.sh");
    expect(prebuild.status, prebuild.stderr).toBe(0);
    expect(prebuild.stderr).toMatch(/SDKROOT/);
    expect(prebuild.stderr).toMatch(/linker|SDK/i);
    const result = f.run("scripts/build-source.sh");
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(f.root, "dist/cli.js"), "utf8")).toContain("console.log");
    expect(existsSync(join(f.root, ".agentbrew-native-prebuilt-fallback"))).toBe(false);
  });
  it("preserves a usable predecessor when the Cargo-free TypeScript candidate fails", () => {
    const f = fixture();
    mkdirSync(join(f.root, "dist"));
    writeFileSync(join(f.root, "dist/cli.js"), "previous usable CLI\n");
    writeFileSync(join(f.root, ".fixture-compile-failure"), "fail\n");
    const result = f.run("scripts/build-source.sh");
    expect(result.status, result.stderr).toBe(73);
    expect(readFileSync(join(f.root, "dist/cli.js"), "utf8")).toBe("previous usable CLI\n");
  });
});

describe("native capability trust boundary", () => {
  it("resolves normal PATH, installed Rustup and Homebrew without treating an unavailable PATH as absence", () => {
    for (const expected of [
      "/fixture/bin/cargo",
      "/fixture/home/.cargo/bin/cargo",
      "/opt/homebrew/opt/rust/bin/cargo",
      "/usr/local/opt/rust/bin/cargo",
    ]) {
      expect(
        native.resolveCargo({
          path: "/fixture/bin",
          home: "/fixture/home",
          canExecute: (path: string) => path === expected,
        }),
      ).toBe(expected);
    }
    expect(native.resolveCargo({ path: "/fixture/bin", home: "/fixture/home", canExecute: () => false })).toBeNull();
  });

  it("accepts the complete fixed source-bound control before negative mutations", () => {
    const f = fixture();
    expect(() => native.readPair(f.root)).not.toThrow();
  });

  it.each(["checkup-run", "publish-dist"])("refuses modified %s bytes", (asset) => {
    const f = fixture();
    const path = join(f.directory, asset);
    const bytes = readFileSync(path);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(path, bytes);
    expect(() => native.readPair(f.root)).toThrow();
  });

  it.each([
    "rust/checkup-run/Cargo.lock",
    "rust/checkup-run/src/lib.rs",
    "scripts/build-native-prebuilt.mjs",
    "scripts/native-build-tools.mjs",
  ])("refuses stale source receipt for %s", (path) => {
    const f = fixture();
    writeFileSync(join(f.root, path), `${readFileSync(join(f.root, path), "utf8")}\n`);
    expect(() => native.readPair(f.root)).toThrow();
  });

  it.each([
    "wrong-target",
    "wrong-recipe",
    "missing-row",
    "duplicate-row",
    "unknown-field",
    "duplicate-json-key",
  ])("refuses the %s manifest", (mutation) => {
    const f = fixture();
    const path = join(f.directory, "manifest.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    if (mutation === "wrong-target") manifest.target = "x86_64-apple-darwin";
    if (mutation === "wrong-recipe") manifest.recipe.id = "other-recipe";
    if (mutation === "missing-row") manifest.inputs.pop();
    if (mutation === "duplicate-row") manifest.inputs.push(manifest.inputs[0]);
    if (mutation === "unknown-field") manifest.assetPath = "/outside/publisher";
    let text = `${JSON.stringify(manifest, null, 2)}\n`;
    if (mutation === "duplicate-json-key")
      text = text.replace('"schemaVersion": 1,', '"schemaVersion": 9, "schemaVersion": 1,');
    writeFileSync(path, text);
    expect(() => native.readPair(f.root)).toThrow();
  });

  it.each([
    "missing",
    "symlink",
    "directory",
    "truncated",
    "wrong-architecture",
  ])("refuses the %s native asset", (mutation) => {
    const f = fixture();
    const path = join(f.directory, "publish-dist");
    const original = readFileSync(path);
    rmSync(path);
    if (mutation === "symlink") symlinkSync(join(source, "native/checkup-run/darwin-arm64/publish-dist"), path);
    if (mutation === "directory") mkdirSync(path);
    if (mutation === "truncated") writeFileSync(path, original.subarray(0, 8));
    if (mutation === "wrong-architecture") {
      original.writeUInt32LE(7, 4);
      writeFileSync(path, original);
    }
    expect(() => native.readPair(f.root)).toThrow();
  });

  it("rejects an extra Rust source inside a nested target-named source directory", () => {
    const f = fixture();
    const directory = join(f.root, "rust/checkup-run/src/target");
    mkdirSync(directory);
    writeFileSync(join(directory, "unlisted.rs"), "pub fn unlisted() {}\n");
    expect(() => native.readPair(f.root)).toThrow();
  });

  it("keeps the already verified private bytes after the repository artifact changes", () => {
    const f = fixture();
    const stage = join(f.root, ".agentbrew-build.12345678");
    mkdirSync(stage, { mode: 0o700 });
    const result = spawnSync(join(f.bin, "node"), [join(f.root, "scripts/native-build-tools.mjs"), "prepare", stage], {
      cwd: f.root,
      env: f.env,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    const expected = readFileSync(join(stage, ".native/publish-dist"));
    writeFileSync(join(f.directory, "publish-dist"), "replaced after verification\n");
    expect(readFileSync(join(stage, ".native/publish-dist"))).toEqual(expected);
    expect(() => native.readPair(f.root)).toThrow();
  });

  it("finds an installed Cargo outside PATH and supplies its adjacent compiler", () => {
    const f = fixture();
    installedCargoFixture(f);
    const result = f.run("scripts/build-checkup-run.sh");
    const hostCalls = existsSync(f.sdkHostCalls)
      ? readFileSync(f.sdkHostCalls, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
    expect(hostCalls, "the compiler fake must not require a host SDK command").toEqual([]);
    expect(result.status, result.stderr).toBe(0);
    const receipt = JSON.parse(
      readFileSync(join(f.root, "rust/checkup-run/target/aarch64-apple-darwin/release/manifest.json"), "utf8"),
    );
    expect(receipt.toolchain).toEqual({
      cargo: "cargo fixture",
      rustc: "rustc fixture",
      clang: "clang fixture",
      sdk: "sdk fixture",
      ld: "ld fixture",
    });
    expect(readFileSync(join(f.root, "compiler-observed"), "utf8").trim()).toBe("rustc fixture");
    expect(() => native.readPair(f.root, true)).not.toThrow();
    expect(result.stderr).not.toMatch(/using.*prebuilt/i);
  });

  it.each([
    ["/usr/bin/clang", ["--not-a-fixture"]],
    ["/usr/bin/xcrun", ["--sdk", "not-a-fixture"]],
  ] as const)("refuses an unrecognized host SDK command %s", (file, args) => {
    const f = fixture();
    const code = `require('node:child_process').execFileSync(${JSON.stringify(file)},${JSON.stringify(args)});`;
    const result = spawnSync(join(f.bin, "node"), ["-e", code], { cwd: f.root, env: f.env, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ENOENT");
    expect(JSON.parse(readFileSync(f.sdkHostCalls, "utf8").trim())).toEqual({ file, args });
  });

  it("keeps SDK unavailable without a fake compiler", () => {
    const f = fixture();
    const code = "require('node:child_process').execFileSync('/usr/bin/clang',['--version']);";
    const result = spawnSync(join(f.bin, "node"), ["-e", code], { cwd: f.root, env: f.env, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ENOENT");
    expect(JSON.parse(readFileSync(f.sdkHostCalls, "utf8").trim())).toEqual({
      file: "/usr/bin/clang",
      args: ["--version"],
    });
  });

  it("does not follow an existing source receipt symlink when recording a successful compilation", () => {
    const f = fixture();
    installedCargoFixture(f);
    const directory = join(f.root, "rust/checkup-run/target/aarch64-apple-darwin/release");
    mkdirSync(directory, { recursive: true });
    const outside = join(f.root, "kept.json");
    writeFileSync(outside, "keep these bytes\n");
    symlinkSync(outside, join(directory, "manifest.json"));
    const result = f.run("scripts/build-checkup-run.sh");
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(outside, "utf8")).toBe("keep these bytes\n");
    expect(() => native.readPair(f.root, true)).not.toThrow();
  });

  it.each(["parent", "artifact"])("preserves outside bytes for a source-store %s link", (kind) => {
    const f = fixture();
    installedCargoFixture(f);
    const directory = join(f.root, "rust/checkup-run/target/aarch64-apple-darwin/release");
    const outside = join(f.root, "outside-source-store");
    mkdirSync(outside);
    writeFileSync(join(outside, "checkup-run"), "preserve outside recorder\n");
    if (kind === "parent") {
      mkdirSync(dirname(directory), { recursive: true });
      symlinkSync(outside, directory);
    } else {
      mkdirSync(directory, { recursive: true });
      symlinkSync(join(outside, "checkup-run"), join(directory, "checkup-run"));
    }
    const result = f.run("scripts/build-checkup-run.sh");
    expect(result.status).not.toBe(0);
    expect(native.sha256(readFileSync(join(outside, "checkup-run")))).toBe(
      native.sha256(Buffer.from("preserve outside recorder\n")),
    );
  });

  it("rejects a partially replaced source pair without executing it", () => {
    const f = fixture();
    installedCargoFixture(f);
    const first = f.run("scripts/build-checkup-run.sh");
    expect(first.status, first.stderr).toBe(0);
    expect(() => native.readPair(f.root, true)).not.toThrow();
    const path = join(f.root, "rust/checkup-run/target/aarch64-apple-darwin/release/checkup-run");
    writeFileSync(path, readFileSync(join(f.directory, "publish-dist")));
    expect(() => native.readPair(f.root, true)).toThrow();
    expect(fs.readdirSync(join(f.root, "rust/checkup-run/target")).some((name) => name.startsWith(".compile-"))).toBe(
      false,
    );
  });

  it("preserves the valid source cache and predecessor when cache staging cannot write", () => {
    const f = fixture();
    installedCargoFixture(f);
    expect(f.run("scripts/build-checkup-run.sh").status).toBe(0);
    const directory = join(f.root, "rust/checkup-run/target/aarch64-apple-darwin/release");
    const observe = () =>
      Object.fromEntries(
        [...native.ASSETS, "manifest.json"].map((name) => {
          const path = join(directory, name);
          const st = fs.lstatSync(path);
          return [name, { digest: native.sha256(readFileSync(path)), dev: st.dev, ino: st.ino }];
        }),
      );
    const before = observe();
    mkdirSync(join(f.root, "dist"));
    writeFileSync(join(f.root, "dist/cli.js"), "keep predecessor\n");
    const mode = fs.lstatSync(directory).mode & 0o777;
    fs.chmodSync(directory, 0o500);
    try {
      const result = f.run("scripts/build-checkup-run.sh");
      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toMatch(/using.*prebuilt/i);
      expect(observe()).toEqual(before);
      expect(() => native.readPair(f.root, true)).not.toThrow();
      expect(readFileSync(join(f.root, "dist/cli.js"), "utf8")).toBe("keep predecessor\n");
    } finally {
      fs.chmodSync(directory, mode);
    }
  });

  it("builds an archive without root Git metadata and records explicit source-only null provenance", () => {
    const f = fixture();
    installedCargoFixture(f);
    rmSync(join(f.root, ".git"), { recursive: true });
    const result = f.run("scripts/build-checkup-run.sh");
    expect(result.status, result.stderr).toBe(0);
    const receipt = JSON.parse(
      readFileSync(join(f.root, "rust/checkup-run/target/aarch64-apple-darwin/release/manifest.json"), "utf8"),
    );
    expect(receipt.sourceRevision).toBeNull();
    expect(() => native.readPair(f.root, true)).not.toThrow();
  });

  it("refuses broken present Git metadata rather than recording null provenance", () => {
    const f = fixture();
    installedCargoFixture(f);
    writeFileSync(join(f.root, ".git/HEAD"), "ref: refs/heads/missing\n");
    expect(f.run("scripts/build-checkup-run.sh").status).not.toBe(0);
  });

  it("refuses null provenance in a carried prebuilt manifest", () => {
    const f = fixture();
    const path = join(f.directory, "manifest.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.sourceRevision = null;
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(() => native.readPair(f.root)).toThrow();
  });

  it.runIf(process.platform === "darwin" && process.arch === "arm64").each(["final copy", "producer cache"])(
    "rebuilds a substituted newer executable from actual Cargo cache %s",
    (variant) => {
      const f = fixture();
      const cargo = native.resolveCargo();
      expect(cargo).toBeTruthy();
      const cache = join(f.root, "cargo-cache");
      mkdirSync(cache);
      builder.privateRegistry(
        cache,
        readFileSync(join(f.root, "rust/checkup-run/Cargo.lock"), "utf8"),
        join(process.env.CARGO_HOME || join(userInfo().homedir, ".cargo"), "registry"),
      );
      const env = {
        ...f.env,
        CARGO_HOME: cache,
        PATH: `${dirname(cargo)}:${dirname(process.execPath)}:/usr/bin:/bin`,
        CARGO_NET_OFFLINE: "true",
        CARGO_BUILD_JOBS: "1",
        MACOSX_DEPLOYMENT_TARGET: "11.0",
        DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer",
      };
      const compile = () =>
        spawnSync("/bin/bash", ["scripts/build-checkup-run.sh"], {
          cwd: f.root,
          env,
          encoding: "utf8",
          timeout: 600_000,
        });
      expect(existsSync(join(f.root, "rust/checkup-run/target"))).toBe(false);
      const first = spawnSync(
        cargo,
        [
          "build",
          "--locked",
          "--release",
          "--manifest-path",
          join(f.root, "rust/checkup-run/Cargo.toml"),
          "--target",
          native.TARGET,
          "--target-dir",
          join(f.root, "rust/checkup-run/target"),
        ],
        {
          cwd: f.root,
          env,
          encoding: "utf8",
          timeout: 600_000,
        },
      );
      expect(first.status, first.stderr).toBe(0);
      const path = join(f.root, "rust/checkup-run/target/aarch64-apple-darwin/release/checkup-run");
      expect(fs.lstatSync(path).size).toBeLessThanOrEqual(64 * 1024 * 1024);
      const original = readFileSync(path);
      const substituted = readFileSync(join(f.directory, "publish-dist"));
      expect(native.sha256(original)).not.toBe(native.sha256(substituted));
      const targets = [path];
      if (variant === "producer cache") {
        const producer = producerPath(
          dirname(path),
          original,
          f.root,
          path,
          () => producerDiagnostic(first.stderr, env, () => producerProbe(cargo, f.root, dirname(path))),
          (message) => console.error(message),
        );
        targets.push(producer);
      }
      const future = new Date(Date.now() + 60_000);
      for (const target of targets) {
        writeFileSync(target, substituted);
        utimesSync(target, future, future);
      }
      for (const target of targets) expect(readFileSync(target)).toEqual(substituted);
      const second = compile();
      expect(second.status, second.stderr).toBe(0);
      const verification = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const native=await import(${JSON.stringify(join(f.root, "scripts/native-build-tools.mjs"))});native.readPair(${JSON.stringify(f.root)},true);`,
        ],
        {
          cwd: f.root,
          env,
          encoding: "utf8",
        },
      );
      expect(verification.status, "the resulting source receipt must validate").toBe(0);
      const actualDigest = native.sha256(readFileSync(path));
      const receipt = JSON.parse(readFileSync(join(dirname(path), "manifest.json"), "utf8"));
      expect(receipt.artifacts["checkup-run"].sha256).toBe(actualDigest);
      expect(receipt.toolchain.clang).not.toBe("clang fixture");
      expect(receipt.toolchain.sdk).not.toBe("sdk fixture");
      expect(receipt.toolchain.ld).not.toBe("ld fixture");
      const state = join(f.root, "native-state");
      const invoke = (...args: string[]) => {
        const result = spawnSync(path, args, {
          cwd: f.root,
          env: { ...env, XDG_STATE_HOME: state },
          encoding: "utf8",
          timeout: 10_000,
        });
        expect(result.status, result.stderr).toBe(0);
        return JSON.parse(result.stdout);
      };
      const label = "cargo-cache-fixture";
      expect(invoke("show", label, "--json")).toEqual({ status: "missing", record: null, record_sha256: null });
      const commit = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
        cwd: f.root,
        env: f.env,
        encoding: "utf8",
      }).trim();
      const payload = { finished_at: "2099-01-01T00:00:00Z", result: "green", commits: { fixture: commit } };
      const recorded = invoke(
        "record",
        label,
        "--finished-at",
        payload.finished_at,
        "--result",
        "green",
        "--commit",
        `fixture=${commit}`,
        "--json",
      );
      const recordDigest = native.sha256(readFileSync(join(state, "checkups", `${label}.json`)));
      expect(recorded).toEqual({ status: "recorded", record: payload, record_sha256: recordDigest, changed: true });
      expect(invoke("show", label, "--json")).toEqual({
        status: "present",
        record: payload,
        record_sha256: recordDigest,
      });
      expect(actualDigest).not.toBe(native.sha256(substituted));
      expect(actualDigest, "the original recorder digest must also be restored").toBe(native.sha256(original));
      fs.writeSync(2, `Source-cache byte identity: ${variant} ${actualDigest === native.sha256(original)}\n`);
    },
    600_000,
  );

  it("refuses source bytes that change while the compiler is running", () => {
    const f = fixture();
    installedCargoFixture(f);
    const cargo = join(f.env.HOME, ".cargo/bin/cargo");
    writeFileSync(cargo, `${readFileSync(cargo, "utf8")}\nprintf '\\n' >> rust/checkup-run/src/lib.rs\n`);
    const result = f.run("scripts/build-checkup-run.sh");
    expect(result.status).not.toBe(0);
    expect(existsSync(join(f.root, "rust/checkup-run/target/aarch64-apple-darwin/release/manifest.json"))).toBe(false);
  });

  it.each([
    ["a signal exit", "#!/bin/bash\nkill -TERM $$\n"],
    ["a spawn failure", "#!/missing/interpreter\n"],
  ])("does not fall back after %s", (_name, cargo) => {
    const f = fixture();
    writeFileSync(join(f.bin, "cargo"), cargo, { mode: 0o755 });
    const result = f.run("scripts/build-checkup-run.sh");
    expect(result.status).toBe(1);
    expect(result.stderr).not.toMatch(/using.*prebuilt/i);
    expect(existsSync(join(f.root, ".agentbrew-native-prebuilt-fallback"))).toBe(false);
  });
  it("does not fall back after a post-build toolchain status 65", () => {
    const f = fixture();
    installedCargoFixture(f);
    writeFileSync(join(f.env.HOME, ".cargo/bin/rustc"), "#!/bin/bash\nexit 65\n", { mode: 0o755 });
    const result = f.run("scripts/build-checkup-run.sh");
    expect(result.status).toBe(1);
    expect(result.stderr).not.toMatch(/using.*prebuilt/i);
    expect(existsSync(join(f.root, ".agentbrew-native-prebuilt-fallback"))).toBe(false);
  });
  it("does not infer fallback from a stale source receipt without the admission marker", () => {
    const f = fixture();
    installedCargoFixture(f);
    expect(f.run("scripts/build-checkup-run.sh").status).toBe(0);
    writeFileSync(
      join(f.root, "rust/checkup-run/src/lib.rs"),
      `${readFileSync(join(f.root, "rust/checkup-run/src/lib.rs"), "utf8")}\n`,
    );
    const result = f.run("scripts/build-source.sh");
    expect(result.status).not.toBe(0);
    expect(existsSync(join(f.root, "dist"))).toBe(false);
  });
  it("uses the prebuilt pair after a compiler failure without modifying the predecessor", () => {
    const f = fixture();
    writeFileSync(join(f.bin, "cargo"), "#!/bin/bash\nexit 79\n", { mode: 0o755 });
    mkdirSync(join(f.root, "dist"));
    writeFileSync(join(f.root, "dist/cli.js"), "previous usable CLI\n");
    const result = f.run("scripts/build-checkup-run.sh");
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/using.*prebuilt/i);
    expect(result.stderr).toMatch(/SDKROOT/);
    expect(readFileSync(join(f.root, "dist/cli.js"), "utf8")).toBe("previous usable CLI\n");
  });
});

describe.runIf(process.platform === "darwin" && process.arch === "arm64")("actual Cargo-free source bundle", () => {
  it("runs the ordinary CLI and native records through the actual bundler without Cargo or target leftovers", async () => {
    const f = fixture();
    cpSync(source, f.root, {
      recursive: true,
      filter: (path) => {
        const parts = relative(source, path).split("/");
        return !parts.some(
          (part) =>
            ["node_modules", ".git", "target", "dist", ".metrics"].includes(part) ||
            part.startsWith(".agentbrew-build."),
        );
      },
    });
    const manifestPath = join(f.directory, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.inputs = native.inputs(f.root);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    rmSync(join(f.bin, "tsup"));
    execFileSync("/bin/cp", ["-cR", join(source, "node_modules"), join(f.root, "node_modules")]);
    const npm = realpathSync(execFileSync("/usr/bin/which", ["npm"], { encoding: "utf8" }).trim());
    symlinkSync(npm, join(f.bin, "npm"));
    const env = {
      PATH: f.env.PATH,
      HOME: f.env.HOME,
      XDG_CONFIG_HOME: join(f.root, "config"),
      XDG_STATE_HOME: join(f.root, "state"),
      BASH_ENV: "",
      ENV: "",
      NODE_OPTIONS: "",
      NODE_PATH: "",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      AGENTBREW_NO_AUTO_SYNC: "1",
      AGENTBREW_NO_SHELL_HOOK: "1",
      AGENTBREW_EVENTS: "0",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
    };
    const git = (...args: string[]) =>
      execFileSync("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: f.root, env, encoding: "utf8" });
    git("add", "-A");
    git("-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "commit", "-qm", "actual source fixture");
    const build = spawnSync(join(f.bin, "npm"), ["run", "build"], {
      cwd: f.root,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);
    expect(build.stderr).toMatch(/using.*prebuilt/i);
    expect(existsSync(join(f.root, "rust/checkup-run/target"))).toBe(false);
    const cli = (...args: string[]) =>
      spawnSync(join(f.bin, "node"), [join(f.root, "dist/cli.js"), ...args], {
        cwd: f.root,
        env,
        encoding: "utf8",
        timeout: 10_000,
      });
    expect(cli("--version").stdout.trim()).toBe("1.0.0");
    const stamp = JSON.parse(readFileSync(join(f.root, "dist/build-info.json"), "utf8"));
    expect(stamp.commit).toBe(git("rev-parse", "HEAD").trim());
    const { checkCliBuildDrift } = await import("./cli-build-health.js");
    expect(checkCliBuildDrift(f.root)).toEqual([]);
    const first = cli("checkup-run", "show", "cargo-free-fixture", "--json");
    expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout).status).toBe("missing");
    const record = cli(
      "checkup-run",
      "record",
      "cargo-free-fixture",
      "--finished-at",
      "2099-01-01T00:00:00Z",
      "--result",
      "green",
      "--commit",
      `fixture=${git("rev-parse", "HEAD").trim()}`,
      "--json",
    );
    expect(record.status, record.stderr).toBe(0);
    const final = cli("checkup-run", "show", "cargo-free-fixture", "--json");
    expect(final.status, final.stderr).toBe(0);
    expect(JSON.parse(final.stdout).status).toBe("present");
  }, 90_000);
});

describe("prebuilt builder output and cache boundary", () => {
  it.each([
    "checkup-run",
    "publish-dist",
    "manifest.json",
    "directory",
  ])("preserves outside bytes for a planted %s output link", (name) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ab-prebuilt-output-")));
    roots.push(root);
    const destination = join(root, "native/checkup-run/darwin-arm64");
    mkdirSync(destination, { recursive: true });
    const outside = join(root, "outside");
    mkdirSync(outside);
    const sentinel = join(outside, name === "directory" ? "publish-dist" : name);
    writeFileSync(sentinel, "keep outside bytes\n");
    if (name === "directory") {
      rmSync(destination, { recursive: true });
      symlinkSync(outside, destination, "dir");
    } else symlinkSync(sentinel, join(destination, name));
    expect(() =>
      builder.publishArtifacts(
        root,
        { "checkup-run": Buffer.from("new recorder"), "publish-dist": Buffer.from("new publisher") },
        {},
      ),
    ).toThrow();
    expect(readFileSync(sentinel, "utf8")).toBe("keep outside bytes\n");
  });

  it.each([
    "archive",
    "index",
    "index-parent",
  ])("refuses a symlinked %s cache input before reading its target", (kind) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ab-cache-link-")));
    roots.push(root);
    const registry = join(root, "cache/registry");
    const cache = "index.crates.io-0000000000000000";
    const archive = join(registry, "cache", cache, "safe-1.0.0.crate");
    const index = join(registry, "index", cache, ".cache/sa/fe/safe");
    mkdirSync(join(registry, "cache", cache), { recursive: true });
    mkdirSync(join(registry, "index", cache, ".cache/sa/fe"), { recursive: true });
    writeFileSync(archive, "archive bytes");
    writeFileSync(index, "index bytes");
    const outside = join(root, "outside");
    mkdirSync(outside);
    const sentinel = join(outside, "safe");
    writeFileSync(sentinel, "private fixture bytes");
    if (kind === "archive") {
      rmSync(archive);
      symlinkSync(sentinel, archive);
    }
    if (kind === "index") {
      rmSync(index);
      symlinkSync(sentinel, index);
    }
    if (kind === "index-parent") {
      rmSync(join(registry, "index", cache, ".cache/sa/fe"), { recursive: true });
      symlinkSync(outside, join(registry, "index", cache, ".cache/sa/fe"), "dir");
    }
    const checksum = native.sha256(readFileSync(kind === "archive" ? sentinel : archive));
    const lock = `[[package]]\nname = "safe"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${checksum}"\n`;
    expect(() => builder.privateRegistry(join(root, "stage"), lock, registry)).toThrow();
  });

  it.each(["name", "version"])("rejects traversal in a locked %s before reading outside the cache", (field) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ab-prebuilt-cache-")));
    roots.push(root);
    const registry = join(root, "cache/registry");
    const cache = "index.crates.io-0000000000000000";
    mkdirSync(join(registry, "cache", cache), { recursive: true });
    mkdirSync(join(registry, "index", cache, ".cache/sa/fe"), { recursive: true });
    writeFileSync(join(registry, "index", cache, ".cache/sa/fe/safe"), "safe metadata");
    const name = field === "name" ? `abcd/${"../".repeat(8)}outside-index` : "safe";
    const version = field === "version" ? `${"../".repeat(6)}outside` : "1.0.0";
    const outside = join(root, field === "name" ? "outside-index" : "outside.crate");
    writeFileSync(outside, "private fixture bytes");
    const index = name.length > 3 ? `${name.slice(0, 2)}/${name.slice(2, 4)}/${name}` : "";
    const resolvedIndex = resolve(registry, "index", cache, ".cache", index);
    const resolvedArchive = resolve(registry, "cache", cache, `${name}-${version}.crate`);
    expect(field === "name" ? resolvedIndex : resolvedArchive).toBe(outside);
    const checksum = native.sha256(readFileSync(outside));
    const lock = `[[package]]\nname = ${JSON.stringify(name)}\nversion = ${JSON.stringify(version)}\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${checksum}"\n`;
    const original = fs.readFileSync;
    let outsideReads = 0;
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((
      path: Parameters<typeof fs.readFileSync>[0],
      ...args: unknown[]
    ) => {
      if (String(path) === outside) outsideReads++;
      return Reflect.apply(original, fs, [path, ...args]);
    }) as typeof fs.readFileSync);
    try {
      expect(() => builder.privateRegistry(join(root, "stage"), lock, registry)).toThrow();
      expect(outsideReads).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
