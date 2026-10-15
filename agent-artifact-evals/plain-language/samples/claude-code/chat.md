The test fails because `parseConfig` returns `undefined` for an empty file.

- Cause: the reader skips files with zero bytes.
- Fix: return an empty object instead.
- Check: run `npx vitest run src/config.test.ts`.

**Needed from you:** nothing
