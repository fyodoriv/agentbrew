import { describe, expect, it, vi } from "vitest";
import {
  createMemoryLaunchdHandoff,
  type LaunchdJob,
  type MemoryLaunchdRuntime,
  parseMemoryUpgradeLaunchdJob,
} from "./upgrade-launchagent.js";

const oldJob: LaunchdJob = {
  path: "/scratch/old.plist",
  home: "/scratch",
  workingDirectory: "/scratch",
  args: ["uvx", "--from", "memory==old"],
  environmentFingerprint: "expected-environment",
  pid: 101,
};
const candidateJob: LaunchdJob = {
  path: "/scratch/new.plist",
  home: "/scratch",
  workingDirectory: "/scratch",
  args: ["uvx", "--from", "memory==new"],
  environmentFingerprint: "expected-environment",
  pid: 303,
};

function fixture() {
  let job: LaunchdJob | null = oldJob;
  let alive = true;
  let listeners = [202];
  const mutate = vi.fn(async (action: "bootout" | "bootstrap", path?: string) => {
    if (action === "bootout") {
      job = null;
      alive = false;
      listeners = [];
    } else job = path === candidateJob.path ? candidateJob : oldJob;
  });
  const runtime: MemoryLaunchdRuntime = {
    readJob: () => job,
    mutate,
    processAlive: () => alive,
    processStamp: () => "synthetic-start",
    isDescendant: () => true,
    environmentSafe: () => true,
    listeners: () => listeners,
    canMutate: () => true,
    plistHash: () => "expected-hash",
    wait: async () => undefined,
  };
  const handoff = createMemoryLaunchdHandoff({
    uid: 501,
    label: "com.example.memory",
    port: 18765,
    oldJob,
    oldListenerPid: 202,
    oldProcessStamp: "synthetic-start",
    oldListenerStamp: "synthetic-start",
    oldPlistHash: "expected-hash",
    candidateJob,
    candidatePlistHash: "expected-hash",
    runtime,
  });
  return {
    handoff,
    mutate,
    runtime,
    setJob: (value: LaunchdJob | null) => {
      job = value;
    },
    setAlive: (value: boolean) => {
      alive = value;
    },
    setListeners: (value: number[]) => {
      listeners = value;
    },
  };
}

describe("memory launchd handoff", () => {
  it("checks candidate identity before and after health observation", async () => {
    const { handoff, mutate, runtime, setJob, setAlive, setListeners } = fixture();
    await handoff.stopOld();
    await handoff.startCandidate();
    setAlive(true);
    setListeners([404]);
    const health = vi.fn(async () => true);
    expect(await handoff.verifyCandidate(health)).toBe(true);
    expect(health).toHaveBeenCalledTimes(1);
    setJob({ ...candidateJob, environmentFingerprint: "changed" });
    expect(await handoff.verifyCandidate(health)).toBe(false);
    setJob(candidateJob);
    runtime.isDescendant = () => false;
    expect(await handoff.verifyCandidate(health)).toBe(false);
    runtime.isDescendant = () => true;
    let stamp = "first";
    runtime.processStamp = () => stamp;
    expect(
      await handoff.verifyCandidate(async () => {
        stamp = "second";
        return true;
      }),
    ).toBe(false);
    expect(mutate.mock.calls.map((call) => call[0])).toEqual(["bootout", "bootstrap"]);
  });

  it("rejects candidate replacement and failed health observations", async () => {
    const { handoff, mutate, runtime, setJob, setAlive, setListeners } = fixture();
    await handoff.stopOld();
    await handoff.startCandidate();
    setAlive(true);
    setListeners([404]);
    expect(await handoff.verifyCandidate(async () => false)).toBe(false);
    expect(
      await handoff.verifyCandidate(async () => {
        throw new Error("synthetic failure");
      }),
    ).toBe(false);
    expect(
      await handoff.verifyCandidate(async () => {
        setListeners([405]);
        return true;
      }),
    ).toBe(false);
    setListeners([404]);
    expect(
      await handoff.verifyCandidate(async () => {
        setJob({ ...candidateJob, path: "/scratch/other.plist" });
        return true;
      }),
    ).toBe(false);
    setJob(candidateJob);
    runtime.plistHash = () => "changed";
    expect(await handoff.verifyCandidate(async () => true)).toBe(false);
    expect(mutate.mock.calls.map((call) => call[0])).toEqual(["bootout", "bootstrap"]);
  });

  it("stops the verified job before registering the candidate", async () => {
    const { handoff, mutate } = fixture();
    await handoff.stopOld();
    expect(await handoff.isOldStopped()).toBe(true);
    await handoff.startCandidate();
    expect(mutate.mock.calls.map((call) => call[0])).toEqual(["bootout", "bootstrap"]);
  });

  it("refuses to stop a different job or a reused process", async () => {
    const { handoff, mutate, runtime, setJob } = fixture();
    setJob({ ...oldJob, path: "/scratch/other.plist" });
    await expect(handoff.stopOld()).rejects.toThrow();
    expect(mutate).not.toHaveBeenCalled();
    setJob(oldJob);
    runtime.processStamp = () => "different-start";
    await expect(handoff.stopOld()).rejects.toThrow();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("refuses a changed loaded environment or unrelated listener", async () => {
    const first = fixture();
    first.setJob({ ...oldJob, environmentFingerprint: "changed" });
    await expect(first.handoff.stopOld()).rejects.toThrow();
    expect(first.mutate).not.toHaveBeenCalled();
    const second = fixture();
    second.runtime.isDescendant = () => false;
    await expect(second.handoff.stopOld()).rejects.toThrow();
    expect(second.mutate).not.toHaveBeenCalled();
    const third = fixture();
    third.runtime.environmentSafe = () => false;
    await expect(third.handoff.stopOld()).rejects.toThrow();
    expect(third.mutate).not.toHaveBeenCalled();
  });

  it("requires each loaded and inherited environment block", () => {
    const output = [
      "\tpath = /scratch/old.plist",
      "\tworking directory = /scratch",
      "\tpid = 101",
      "\targuments = {",
      "\t\tuvx",
      "\t\t--from",
      "\t\tmemory==old",
      "\t}",
      "\tenvironment = {",
      "\t\tHOME => /scratch",
      "\t}",
      "\tinherited environment = {",
      "\t\tPATH => /bin",
      "\t}",
      "\tdefault environment = {",
      "\t\tLANG => C",
      "\t}",
    ].join("\n");
    const first = parseMemoryUpgradeLaunchdJob(output);
    const changed = parseMemoryUpgradeLaunchdJob(output.replace("LANG => C", "LANG => other"));
    expect(first.environmentFingerprint).not.toBe(changed.environmentFingerprint);
    expect(() => parseMemoryUpgradeLaunchdJob(output.replace("default environment", "missing"))).toThrow();
  });

  it("does not register a candidate while the old listener survives", async () => {
    const { handoff, mutate, setJob, setAlive, setListeners } = fixture();
    setJob(null);
    setAlive(false);
    setListeners([202]);
    await expect(handoff.startCandidate()).rejects.toThrow();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("does not hide an uncertain candidate registration", async () => {
    const { handoff, mutate, setJob, setAlive, setListeners } = fixture();
    setJob(null);
    setAlive(false);
    setListeners([]);
    mutate.mockImplementation(async () => {
      throw new Error("synthetic lost response");
    });
    await expect(handoff.startCandidate()).rejects.toThrow("synthetic lost response");
  });

  it("does not mutate when job state or the local launchd target is unknown", async () => {
    const { handoff, mutate, runtime } = fixture();
    runtime.readJob = () => {
      throw new Error("unavailable");
    };
    await expect(handoff.stopOld()).rejects.toThrow();
    expect(mutate).not.toHaveBeenCalled();
    runtime.readJob = () => oldJob;
    runtime.canMutate = () => false;
    await expect(handoff.stopOld()).rejects.toThrow();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("fails when a successful stop leaves the job or process alive", async () => {
    const { handoff, mutate } = fixture();
    mutate.mockImplementation(async () => undefined);
    await expect(handoff.stopOld()).rejects.toThrow("did not stop");
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("refuses a candidate whose job file changed", async () => {
    const { handoff, mutate, runtime, setJob, setAlive, setListeners } = fixture();
    setJob(null);
    setAlive(false);
    setListeners([]);
    runtime.plistHash = () => "different-hash";
    await expect(handoff.startCandidate()).rejects.toThrow("job file changed");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("reports an unexpected registered candidate instead of claiming success", async () => {
    const { handoff, mutate, setJob, setAlive, setListeners } = fixture();
    setJob(null);
    setAlive(false);
    setListeners([]);
    mutate.mockImplementation(async () => {
      setJob({ ...candidateJob, args: ["unexpected"] });
    });
    await expect(handoff.startCandidate()).rejects.toThrow("registered launchd job is unexpected");
  });

  it("reports changed environment after candidate registration as uncertain", async () => {
    const { handoff, mutate, runtime, setJob, setAlive, setListeners } = fixture();
    setJob(null);
    setAlive(false);
    setListeners([]);
    let safe = true;
    runtime.environmentSafe = () => safe;
    mutate.mockImplementation(async () => {
      setJob(candidateJob);
      safe = false;
    });
    await expect(handoff.startCandidate()).rejects.toThrow("registered launchd job is unexpected");
    expect(mutate).toHaveBeenCalledOnce();
  });
});
