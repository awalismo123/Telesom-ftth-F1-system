/**
 * Tiny class-name joiner. `clsx` is not worth a dependency for one line, and
 * this version is honest about the only thing we use it for.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
