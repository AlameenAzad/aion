import axios from 'axios';
import { parseLeaveRequestRows, PeopleForceClient } from '../../src/api/peopleforce';

jest.mock('axios');

// Mirrors the real markup shape confirmed against a live authenticated
// response (see class doc in src/api/peopleforce.ts): tightly-packed
// Tailwind markup with NO whitespace between some sibling tags (an earlier
// version of this parser assumed newline-separated text and silently
// matched nothing against real output), a `#leave-requests-frame` wrapper
// that must be used for scoping (the page's separate History ledger table
// reuses the same `data-row-id` attribute for unrelated rows), and the
// status text server-rendered inside a Vue component's fallback markup.
const FIXTURE_HTML = `
<html><body>
  <div id="leave-requests-frame">
    <table>
      <tbody>
        <tr data-row-id="1001">
          <td>
            <div class="tw-flex tw-gap-2 tw-relative"><div><div title="Annual Vacation"><i class="fas fa-plane"></i></div></div><div><div class="tw-flex tw-gap-2"><a class="stretched-link" href="https://kruschecompany.peopleforce.io/leave_requests/1001?return_url=x">Annual Vacation</a></div><div class="tw-text-neutral-dark-100">14 Sep 26 - 18 Sep 26</div></div></div>
          </td>
          <td>
            5.0  days
          </td>
          <td>
            <div><div data-component="pf-badge"><pf-config-provider><pf-badge v-bind="bindingProps"><span>Approved</span></pf-badge></pf-config-provider></div></div>
          </td>
        </tr>
        <tr data-row-id="1002">
          <td>
            <div class="tw-flex tw-gap-2 tw-relative"><div><div title="Sick Leave"><i class="fas fa-briefcase-medical"></i></div></div><div><div class="tw-flex tw-gap-2"><a class="stretched-link" href="https://kruschecompany.peopleforce.io/leave_requests/1002?return_url=x">Sick Leave</a></div><div class="tw-text-neutral-dark-100">18 Aug 26 - 18 Aug 26</div></div></div>
          </td>
          <td>
            1.0  days
          </td>
          <td>
            <div><div data-component="pf-badge"><pf-config-provider><pf-badge v-bind="bindingProps"><span>Approved</span></pf-badge></pf-config-provider></div></div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <div id="leave-histories-frame">
    <table>
      <tbody>
        <tr data-row-id="9999">
          <td>01.09.2026</td>
          <td>Accrual</td>
          <td>+1.66</td>
        </tr>
      </tbody>
    </table>
  </div>
</body></html>
`;

describe('parseLeaveRequestRows', () => {
  it('extracts leave type, date range, amount, status, and request id per row', () => {
    const rows = parseLeaveRequestRows(FIXTURE_HTML);

    expect(rows).toEqual([
      {
        requestId: 1001,
        leaveType: 'Annual Vacation',
        startsOn: '14 Sep 26',
        endsOn: '18 Sep 26',
        amountDays: '5.0',
        status: 'Approved',
      },
      {
        requestId: 1002,
        leaveType: 'Sick Leave',
        startsOn: '18 Aug 26',
        endsOn: '18 Aug 26',
        amountDays: '1.0',
        status: 'Approved',
      },
    ]);
  });

  it('ignores unrelated rows in the History ledger table (same data-row-id attribute, different frame)', () => {
    const rows = parseLeaveRequestRows(FIXTURE_HTML);
    expect(rows.find((r) => r.requestId === 9999)).toBeUndefined();
  });

  it('returns an empty array when there are no requests', () => {
    expect(
      parseLeaveRequestRows('<html><body><div id="leave-requests-frame"></div></body></html>')
    ).toEqual([]);
  });

  it('skips a row missing a leave type or date range instead of throwing', () => {
    const html = `
      <html><body>
        <div id="leave-requests-frame">
          <table><tbody>
            <tr data-row-id="1"><td></td><td>5.0  days</td><td><span>Approved</span></td></tr>
          </tbody></table>
        </div>
      </body></html>
    `;
    expect(parseLeaveRequestRows(html)).toEqual([]);
  });
});

describe('PeopleForceClient', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;
  const mockGet = jest.fn();

  let capturedRequestCb: ((cfg: unknown) => unknown) | undefined;
  let capturedResponseSuccessCb: ((res: unknown) => unknown) | undefined;
  let capturedResponseErrorCb: ((err: unknown) => Promise<unknown>) | undefined;

  const requestInterceptorUse = jest.fn((cb: (cfg: unknown) => unknown) => {
    capturedRequestCb = cb;
  });
  // PeopleForceClient registers its own verbose-logging interceptor FIRST,
  // then applyRetryInterceptor registers a second one — only capture the
  // first call, otherwise these vars end up holding retry's callbacks
  // instead of peopleforce.ts's.
  const responseInterceptorUse = jest.fn(
    (successCb: (res: unknown) => unknown, errorCb: (err: unknown) => Promise<unknown>) => {
      if (!capturedResponseSuccessCb) {
        capturedResponseSuccessCb = successCb;
        capturedResponseErrorCb = errorCb;
      }
    }
  );

  mockedAxios.create.mockReturnValue({
    get: mockGet,
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: {
      request: { use: requestInterceptorUse },
      response: { use: responseInterceptorUse },
    },
  } as unknown as ReturnType<typeof axios.create>);

  const client = new PeopleForceClient('https://kruschecompany.peopleforce.io', 'session=abc');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('discoverEmployeeId', () => {
    it('extracts the employee id from a /people/{id} link on the dashboard', async () => {
      mockGet.mockResolvedValueOnce({
        data: '<a href="/people/778503">Go to my profile</a>',
        request: { res: { responseUrl: 'https://kruschecompany.peopleforce.io/dashboards' } },
      });

      await expect(client.discoverEmployeeId()).resolves.toBe(778503);
      expect(mockGet).toHaveBeenCalledWith('/dashboards');
    });

    it('throws when no /people/{id} link is present', async () => {
      mockGet.mockResolvedValueOnce({
        data: '<html>no profile link here</html>',
        request: { res: { responseUrl: 'https://kruschecompany.peopleforce.io/dashboards' } },
      });

      await expect(client.discoverEmployeeId()).rejects.toThrow(
        'Could not find your PeopleForce employee ID'
      );
    });

    it('throws a login-expired error when the response lands on the sign-in page (via redirect URL)', async () => {
      mockGet.mockResolvedValueOnce({
        data: '<html>redirected</html>',
        request: { res: { responseUrl: 'https://kruschecompany.peopleforce.io/users/sign_in' } },
      });

      await expect(client.discoverEmployeeId()).rejects.toThrow(
        'PeopleForce session cookie is missing or expired'
      );
    });

    it('throws a login-expired error when the sign-in page is detected by content, not URL', async () => {
      mockGet.mockResolvedValueOnce({
        data: '<html>Sign in with Microsoft</html>',
        request: undefined,
      });

      await expect(client.discoverEmployeeId()).rejects.toThrow(
        'PeopleForce session cookie is missing or expired'
      );
    });
  });

  describe('testConnection', () => {
    it('resolves when the employee id can be discovered', async () => {
      mockGet.mockResolvedValueOnce({
        data: '<a href="/people/778503">Go to my profile</a>',
        request: { res: { responseUrl: 'https://kruschecompany.peopleforce.io/dashboards' } },
      });

      await expect(client.testConnection()).resolves.toBeUndefined();
    });
  });

  describe('getLeaveCases', () => {
    it('discovers the employee id, then fetches and parses their leave page', async () => {
      mockGet.mockResolvedValueOnce({
        data: '<a href="/people/778503">Go to my profile</a>',
        request: { res: { responseUrl: 'https://kruschecompany.peopleforce.io/dashboards' } },
      });
      mockGet.mockResolvedValueOnce({
        data: FIXTURE_HTML,
        request: { res: { responseUrl: 'https://kruschecompany.peopleforce.io/people/778503/leave' } },
      });

      const rows = await client.getLeaveCases();
      expect(mockGet).toHaveBeenNthCalledWith(2, '/people/778503/leave');
      expect(rows).toHaveLength(2);
      expect(rows[0].leaveType).toBe('Annual Vacation');
    });
  });

  it('logs request/response lifecycle via the interceptors it registers', async () => {
    expect(capturedRequestCb).toBeDefined();
    expect(capturedResponseSuccessCb).toBeDefined();
    expect(capturedResponseErrorCb).toBeDefined();

    expect(capturedRequestCb?.({ method: 'get', url: '/dashboards' })).toEqual({
      method: 'get',
      url: '/dashboards',
    });
    expect(capturedResponseSuccessCb?.({ status: 200, config: { url: '/dashboards' } })).toEqual({
      status: 200,
      config: { url: '/dashboards' },
    });
    await expect(
      capturedResponseErrorCb?.({ config: { url: '/dashboards' }, response: { status: 500 } })
    ).rejects.toBeDefined();
  });

  it('response error interceptor handles network error (no response) and missing config', async () => {
    await expect(capturedResponseErrorCb?.({ config: { url: '/dashboards' } })).rejects.toBeDefined();
    await expect(capturedResponseErrorCb?.({ response: { status: 500 } })).rejects.toBeDefined();
  });
});
