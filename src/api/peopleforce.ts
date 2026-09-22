import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { applyRetryInterceptor } from '../utils/retry';
import { verboseLog } from '../utils/verbose';

export interface PeopleForceLeaveRow {
  requestId?: number;
  leaveType: string;
  startsOn: string;
  endsOn: string;
  amountDays: string;
  status: string;
}

/**
 * Talks to PeopleForce using a session cookie captured from the user's own
 * logged-in browser (see src/utils/browserCookies.ts) — there is no per-user
 * OAuth or password login available, only a company-wide admin API key we
 * don't have access to (see design doc).
 *
 * Verified directly against a real logged-in session (kruschecompany.peopleforce.io):
 * PeopleForce's web app is server-rendered (Rails-style) with NO JSON/XHR API calls
 * observed for any of these pages — every leave/profile page is plain HTML. So
 * this client fetches HTML and parses it, rather than calling a JSON endpoint like
 * PeopleForce's documented (but inapplicable here — that one needs a company API
 * key, not a cookie) public partner API.
 *
 * Confirmed structure (verified against a real authenticated response, not
 * guessed — see parseLeaveRequestRows):
 *   - Company-specific subdomain: https://<company>.peopleforce.io (not a shared domain)
 *   - Employee's own numeric ID is discoverable from any authenticated page via a
 *     `/people/{id}` link (e.g. the "Go to my profile" link on /dashboards).
 *   - Time off / leave requests: GET /people/{id}/leave — inside
 *     `#leave-requests-frame`, a Turbo/Hotwire-rendered table with one
 *     `<tr data-row-id="{requestId}">` per request.
 */
export class PeopleForceClient {
  private client: AxiosInstance;

  constructor(baseUrl: string, sessionCookie: string) {
    this.client = axios.create({
      baseURL: baseUrl.replace(/\/$/, ''),
      headers: {
        Accept: 'text/html',
        Cookie: sessionCookie,
      },
      timeout: 30000,
      validateStatus: (status) => status < 500,
    });
    this.client.interceptors.request.use((cfg) => {
      verboseLog(`[PeopleForce] ${cfg.method?.toUpperCase()} ${cfg.url}`);
      return cfg;
    });
    this.client.interceptors.response.use(
      (res) => {
        verboseLog(`[PeopleForce] ${res.status} ${res.config.url}`);
        return res;
      },
      (err) => {
        verboseLog(
          `[PeopleForce] ERROR ${err?.response?.status ?? 'network'} ${err?.config?.url}`
        );
        return Promise.reject(err);
      }
    );
    applyRetryInterceptor(this.client, 'PeopleForce');
  }

  /**
   * Verifies the session cookie is still valid by discovering the employee ID —
   * this fails distinguishably (not-logged-in vs. other errors) since a login
   * redirect lands on the sign-in page rather than returning a 401/403.
   */
  async testConnection(): Promise<void> {
    await this.discoverEmployeeId();
  }

  /**
   * Finds the logged-in user's PeopleForce employee ID from a `/people/{id}`
   * link on the dashboard — there is no `/people/me` shortcut (confirmed: 404s).
   */
  async discoverEmployeeId(): Promise<number> {
    const res = await this.client.get<string>('/dashboards');
    this.assertLoggedIn(res.data, res.request?.res?.responseUrl);

    const match = /\/people\/(\d+)"/.exec(res.data);
    if (!match) {
      throw new Error('Could not find your PeopleForce employee ID on the dashboard page.');
    }
    return Number(match[1]);
  }

  async getLeaveCases(): Promise<PeopleForceLeaveRow[]> {
    const employeeId = await this.discoverEmployeeId();
    const res = await this.client.get<string>(`/people/${employeeId}/leave`);
    this.assertLoggedIn(res.data, res.request?.res?.responseUrl);

    return parseLeaveRequestRows(res.data);
  }

  private assertLoggedIn(html: string, finalUrl?: string): void {
    const onSignInPage =
      (finalUrl?.includes('/users/sign_in') ?? false) || html.includes('Sign in with Microsoft');
    if (onSignInPage) {
      throw new Error('PeopleForce session cookie is missing or expired — please log in again.');
    }
  }
}

/**
 * Parses the "Requests" table on /people/{id}/leave. Verified live against a
 * real response: each request is a `<tr data-row-id="{id}">` inside
 * `#leave-requests-frame` (scoping to that frame matters — the page's
 * separate "History" ledger table below it reuses the same `data-row-id`
 * attribute for unrelated accrual/adjustment rows). Per row:
 *   - cell 0: an `<a href=".../leave_requests/{id}...">{leave type name}</a>`
 *     plus a sibling `.tw-text-neutral-dark-100` div holding the date range
 *     ("14 Sep 26 - 18 Sep 26")
 *   - cell 1: the amount, rendered as "5.0  days" (note: double space)
 *   - cell 2: the status, server-rendered inside a Vue component's fallback
 *     markup as `<span>Approved</span>` (present in the raw HTML — Vue only
 *     hydrates it client-side, doesn't require JS to read it)
 */
export function parseLeaveRequestRows(html: string): PeopleForceLeaveRow[] {
  const $ = cheerio.load(html);
  const rows: PeopleForceLeaveRow[] = [];

  $('#leave-requests-frame tr[data-row-id]').each((_, tr) => {
    const $tr = $(tr);
    const requestIdAttr = $tr.attr('data-row-id');
    const $cells = $tr.find('td');
    const $typeCell = $cells.eq(0);

    const leaveType = $typeCell.find('a').first().text().trim();
    const dateRangeText = $typeCell.find('div.tw-text-neutral-dark-100').first().text().trim();
    const [startsOn, endsOn] = dateRangeText.split(/\s*-\s*/).map((s) => s.trim());

    const amountMatch = /([\d.]+)/.exec($cells.eq(1).text());
    const status = $cells.eq(2).find('span').first().text().trim();

    if (!leaveType || !startsOn || !endsOn) return;

    rows.push({
      requestId: requestIdAttr ? Number(requestIdAttr) : undefined,
      leaveType,
      startsOn,
      endsOn,
      amountDays: amountMatch ? amountMatch[1] : '',
      status,
    });
  });

  return rows;
}
