import { z } from 'zod';

export const DyceMappingSchema = z.object({
  /** Jira project key prefix, e.g. "PROJ" */
  jiraProjectKey: z.string().min(1),
  /** Human-readable label for this mapping */
  label: z.string().optional(),
  dyce: z.object({
    customerNo: z.string().min(1),
    customerId: z.string().optional(),
    customerName: z.string().optional(),
    jobNo: z.string().min(1),
    jobId: z.string().optional(),
    jobDescription: z.string().optional(),
    jobTaskNo: z.string().min(1),
    jobTaskId: z.string().optional(),
    jobTaskDescription: z.string().optional(),
    jobPlanningLineId: z.string().optional(),
    jobPlanningLineDescription: z.string().optional(),
  }),
});

export const ConfigSchema = z.object({
  tempo: z.object({
    token: z.string().min(1),
    /** Base URL, e.g. "https://api.eu.tempo.io" */
    baseUrl: z.string().url(),
    /** Jira accountId of the user, e.g. "1111aaaa2222bbbb3333cccc" */
    accountId: z.string().min(1),
  }),
  jira: z.object({
    /** e.g. "https://yourcompany.atlassian.net" */
    baseUrl: z.string().url(),
    email: z.string().email(),
    token: z.string().min(1),
  }),
  dyce: z.object({
    /** Azure AD client ID of the Dyce application */
    clientId: z.string().min(1),
    /** OAuth2 scope(s) used when authenticating, e.g. "api://<clientId>/.default offline_access" */
    scope: z.string().min(1),
    /** Cached access token — refreshed automatically when expired */
    token: z.string().optional(),
    /** OAuth2 refresh token — used to obtain new access tokens */
    refreshToken: z.string().min(1),
    /** Dyce instance identifier (x-instance header) */
    instance: z.string().min(1),
    /** Dyce company identifier (x-company header) */
    company: z.string().min(1),
    /** The user's Dyce resource No, e.g. "EMP001" */
    resourceNo: z.string().min(1),
    /** The user's Dyce resource UUID */
    resourceId: z.string().optional(),
    resourceName: z.string().optional(),
  }),
  /** Per-project mappings from Jira project key → Dyce job info */
  mappings: z.array(DyceMappingSchema),
  /** Jira project key prefixes that indicate vacation/sick leave, e.g. ["VAC", "LEAVE"] */
  vacationPrefixes: z.array(z.string()),
  /** Description to send to Dyce for government-approved official public holidays */
  publicHolidayDescription: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type DyceMapping = z.infer<typeof DyceMappingSchema>;
