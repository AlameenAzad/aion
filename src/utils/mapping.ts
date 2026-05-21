import { DyceMapping } from '../config/schema';

/**
 * Extract the project key from a Jira issue key.
 * e.g. "PROJ-123" → "PROJ", "VAC-1" → "VAC"
 */
export function extractProjectKey(issueKey: string): string {
  return issueKey.split('-')[0].toUpperCase();
}

/**
 * Find the Dyce mapping for a given Jira issue key.
 */
export function findMapping(issueKey: string, mappings: DyceMapping[]): DyceMapping | undefined {
  return findMappings(issueKey, mappings)[0];
}

/**
 * Find all applicable mappings for a Jira issue key.
 * Exact issue-key mappings are returned first; if none exist, project-prefix mappings are returned.
 */
export function findMappings(issueKey: string, mappings: DyceMapping[]): DyceMapping[] {
  const normalizedIssueKey = issueKey.trim().toUpperCase();
  const projectKey = extractProjectKey(normalizedIssueKey);

  // Prefer exact issue-key mappings (e.g. INP1-11755) over project-prefix mappings (e.g. INP1).
  const exact = mappings.filter(
    (m) => m.jiraProjectKey.trim().toUpperCase() === normalizedIssueKey
  );
  if (exact.length > 0) return exact;

  return mappings.filter((m) => m.jiraProjectKey.trim().toUpperCase() === projectKey);
}

/**
 * Check if a Jira issue key belongs to a vacation/leave/sick project.
 */
export function isVacationEntry(issueKey: string, vacationPrefixes: string[]): boolean {
  const normalizedIssueKey = issueKey.trim().toUpperCase();
  const projectKey = extractProjectKey(normalizedIssueKey);

  return vacationPrefixes.some((value) => {
    const token = value.trim().toUpperCase();
    if (!token) return false;

    // Allow exact issue keys like "INP1-11755" in addition to project prefixes like "INP1".
    return token.includes('-') ? token === normalizedIssueKey : token === projectKey;
  });
}
