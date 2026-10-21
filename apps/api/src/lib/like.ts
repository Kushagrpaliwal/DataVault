/**
 * Escape the wildcards in a search term.
 *
 * `%` and `_` are wildcards in a LIKE pattern and `\` escapes them, so a
 * search for "50%" used to match every row that started with "50" instead of
 * the rows that really contain "50%". The term is wrapped in wildcards here
 * so the caller only has to think about the text the user typed.
 */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
