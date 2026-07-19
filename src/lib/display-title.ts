/**
 * Keep scan-level route titles about the route itself. Legal dates remain in
 * the detail copy, facts, and sources where they have context.
 */
export function displayRouteTitle(title: string): string {
  return title
    .replace(
      /\s*\((?:post-)?(?:19|20)\d{2}(?:\s*,\s*(?:19|20)\d{2}(?:\s+protocol)?)?\)/gi,
      '',
    )
    .replace(
      /\s+(?:19|20)\d{2}(?=\s+(?:accord|agreement|convention|treaty|act|law)\b)/gi,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}
