import { z } from 'zod';
import { SUPPORTED_BROWSERS } from '../utils/browserCookies';

const DyceJobInfoSchema = z.object({
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
});

export const DyceMappingSchema = z.object({
  /** Jira project key prefix, e.g. "PROJ" */
  jiraProjectKey: z.string().min(1),
  /** Human-readable label for this mapping */
  label: z.string().optional(),
  dyce: DyceJobInfoSchema,
});

/**
 * Dyce destination for a specific leave type (no Jira key needed — the leave
 * type is determined during sync by the user's selection).
 */
export const DyceLeaveMappingSchema = z.object({
  /** Human-readable label, e.g. "Vacation Account" */
  label: z.string().optional(),
  dyce: DyceJobInfoSchema,
});

export type DyceLeaveMapping = z.infer<typeof DyceLeaveMappingSchema>;

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
    /**
     * Browser to read the `login.microsoftonline.com` AAD SSO session cookie
     * from when the refresh token itself has expired (Dyce's SPA app
     * registration issues refresh tokens with a 24h absolute lifetime, so the
     * hourly refresh cron will eventually hit this). Falls back to
     * `peopleforce.browser` when unset, since it's normally the same browser
     * session. See resolveDyceToken in src/api/msauth.ts.
     */
    browser: z.enum(SUPPORTED_BROWSERS).optional(),
    /**
     * Explicit opt-out of silent re-auth, separate from `browser` being unset.
     * Needed because `browser` here can be undefined while silent re-auth is
     * still effectively enabled via the `peopleforce.browser` fallback in
     * resolveDyceToken — without this flag there's no way to say "no, really,
     * don't read my browser's cookies for this" short of also disabling
     * PeopleForce's own browser-based cookie read.
     */
    silentReauthDisabled: z.boolean().optional(),
  }),
  paser: z
    .object({
      /** Paser base URL, e.g. "https://app.paser.io" */
      baseUrl: z.string().url(),
      email: z.string().email(),
      password: z.string().min(1),
      /** Paser account id, e.g. 90 */
      accountId: z.number().int().positive(),
    })
    .optional(),
  peopleforce: z
    .object({
      /** PeopleForce base URL, e.g. "https://yourcompany.peopleforce.io" */
      baseUrl: z.string().url(),
      /**
       * Browser to auto-read the PeopleForce session cookie from. Optional —
       * only used when manualCookie isn't set. Auto-read needs macOS Full
       * Disk Access, which is often blocked on managed/MDM company laptops;
       * manualCookie is the permission-free fallback.
       */
      browser: z.enum(SUPPORTED_BROWSERS).optional(),
      /**
       * Session cookie pasted by the user from DevTools (Network tab → any
       * request to the domain → Request Headers → Cookie), used verbatim as
       * the Cookie header. Takes priority over browser-based auto-read.
       * Unlike Paser's password, this has no refresh mechanism — it expires
       * and needs re-pasting periodically via `aion config edit-peopleforce`.
       */
      manualCookie: z.string().min(1).optional(),
    })
    .optional(),
  /** Which leave provider is active for this sync run — determines which of the two blocks above is used */
  leaveProvider: z.enum(['paser', 'peopleforce']).optional(),
  /** Whether the user has already been shown the one-time "PeopleForce is now available" notice */
  peopleforceNoticeShown: z.boolean().optional(),
  /** Whether the user has already been shown the one-time "Dyce silent re-auth is now available" notice */
  dyceAutoReauthNoticeShown: z.boolean().optional(),
  /** Per-project mappings from Jira project key → Dyce job info */
  mappings: z.array(DyceMappingSchema),
  /** Jira project key prefixes that indicate vacation/sick leave, e.g. ["VAC", "LEAVE"] */
  vacationPrefixes: z.array(z.string()),
  /**
   * Dyce destinations for each leave type.
   * These are separate from the regular per-project mappings and take precedence
   * when a worklog is classified as a leave/holiday entry during sync.
   */
  leaveTypeMappings: z
    .object({
      /** Where to log vacation days in Dyce */
      vacation: DyceLeaveMappingSchema.optional(),
      /** Where to log sick leave days in Dyce */
      sickLeave: DyceLeaveMappingSchema.optional(),
      /** Where to log public / bank holidays in Dyce */
      publicHoliday: DyceLeaveMappingSchema.optional(),
    })
    .optional(),
  /** Description to send to Dyce for government-approved official public holidays */
  publicHolidayDescription: z.string().optional(),
  /** Schema version — used for migrations. 1 = pre-PeopleForce, 2 = adds leaveProvider/peopleforceNoticeShown. */
  schemaVersion: z.number().int().default(1),
});

export type Config = z.infer<typeof ConfigSchema>;
export type DyceMapping = z.infer<typeof DyceMappingSchema>;

// ── File-on-disk schema ───────────────────────────────────────────────────────
// Mirrors ConfigSchema but secret fields are optional: when the OS keychain is
// in use those values are absent from the JSON file and injected at load time.

export const FileConfigSchema = ConfigSchema.extend({
  tempo: ConfigSchema.shape.tempo.extend({ token: z.string().optional() }),
  jira: ConfigSchema.shape.jira.extend({ token: z.string().optional() }),
  dyce: ConfigSchema.shape.dyce.extend({
    token: z.string().optional(),
    refreshToken: z.string().optional(),
  }),
  paser: z
    .object({
      baseUrl: z.string().url(),
      email: z.string().email(),
      password: z.string().optional(),
      accountId: z.number().int().positive(),
    })
    .optional(),
});

export type FileConfig = z.infer<typeof FileConfigSchema>;
