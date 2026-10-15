/* TOML has no null, so skip agents whose override is null. */
export function shouldWrite(override: string | null | undefined): boolean {
  return override !== null;
}
