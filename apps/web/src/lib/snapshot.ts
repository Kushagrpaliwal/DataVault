/**
 * The rules the snapshot is shown under.
 *
 * A snapshot is a page as it was, and a page can ask for anything: a
 * picture from another site, a style sheet, a script. The rule says that
 * the page in the frame may not reach out to anybody, so it cannot report
 * that it was opened, and the only pictures it may show are the ones that
 * were saved with it.
 */
export const SNAPSHOT_POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`;

/**
 * The snapshot, with the rule at the front of it.
 *
 * The rule has to come before anything else in the page, and a rule
 * before the doctype would put the page into the old way of laying out,
 * so the doctype is taken away with it.
 */
export function snapshotWithPolicy(snapshot: string): string {
  return `${SNAPSHOT_POLICY}${snapshot.replace(/^\s*<!doctype[^>]*>/i, "")}`;
}
