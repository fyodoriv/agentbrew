/**
 * Credentials inside git URLs, kept out of output and saved state.
 *
 * For http(s), any user info is a credential (`user:token@`, `token@`).
 * For other schemes only a password is (`ssh://git:secret@`): the user name
 * (`git@`) is part of the address. The scp form `git@host:path` has no
 * credentials.
 */

/** `http(s)://<userinfo>@`. No `\b`: chalk's color code before a URL ends in a letter. */
// Greedy up to the last `@` before the path, so an unencoded `@` in a password is covered too.
const HTTP_USERINFO = /(https?:\/\/)[^\s/'"`]+@/gi;

/** `<scheme>://<user>:<password>@` for any other scheme. */
const OTHER_PASSWORD = /((?!https?:)[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"`]+):[^\s/'"`]+@/gi;

/** `text` with every URL credential shown as `***`. Safe to print or log. */
export function redactUrlCredentials(text: string): string {
  return text.replace(HTTP_USERINFO, "$1***@").replace(OTHER_PASSWORD, "$1:***@");
}

/** `url` without its credentials, for saved state (git can use a credential helper instead). */
export function stripUrlCredentials(url: string): string {
  return url.replace(HTTP_USERINFO, "$1").replace(OTHER_PASSWORD, "$1@");
}
