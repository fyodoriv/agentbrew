declare module "write-file-atomic" {
  export function sync(
    filename: string,
    data: string | Buffer,
    options?: string | { encoding?: string; mode?: number; chown?: { uid: number; gid: number } },
  ): void;
}
