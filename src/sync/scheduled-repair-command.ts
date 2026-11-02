import { basename, isAbsolute } from "node:path";

/** Launch-context check only; queue and repair policies stay in their existing owners. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: POSIX parameter expansion must reach the launch-context shell unchanged.
export const SCHEDULED_REPAIR_GUARD = 'if [ -n "${HEAVY_RUN_HELD:-}" ]; then exit 78; fi; exec "$@"';

/** Recognize only the generated queue wrapper, never arbitrary shell arguments. */
export function queuedRepairCommand(args: readonly string[]): { queue: string; node: string } | undefined {
  if (
    args.length !== 8 ||
    args[0] !== "/bin/sh" ||
    args[1] !== "-c" ||
    args[2] !== SCHEDULED_REPAIR_GUARD ||
    args[3] !== "agentbrew-scheduled-repair" ||
    !isAbsolute(args[4]) ||
    basename(args[4]) !== "heavy-run" ||
    !isAbsolute(args[5]) ||
    !isAbsolute(args[6]) ||
    args[7] !== "fix"
  )
    return undefined;
  return { queue: args[4], node: args[5] };
}
