import { promptPeopleForceSetup } from '../../src/utils/peopleforceSetup';
import { promptText, promptList, promptConfirm, promptPassword } from '../../src/ui/prompts';
import { PeopleForceClient } from '../../src/api/peopleforce';
import {
  openPeopleForceLogin,
  getPeopleForceSessionCookie,
  CookieAccessDeniedError,
} from '../../src/utils/browserCookies';

jest.mock('../../src/ui/prompts', () => ({
  promptText: jest.fn(),
  promptList: jest.fn(),
  promptConfirm: jest.fn(),
  promptPassword: jest.fn(),
  printHint: jest.fn(),
  printSuccess: jest.fn(),
  printError: jest.fn(),
}));
jest.mock('../../src/ui/banner', () => ({ showInfoBox: jest.fn() }));
jest.mock('../../src/ui/spinner', () => ({
  withSpinner: jest.fn((_text: string, fn: () => unknown) => fn()),
}));
jest.mock('../../src/api/peopleforce', () => ({
  PeopleForceClient: jest.fn(),
}));
jest.mock('../../src/utils/browserCookies', () => ({
  ...jest.requireActual('../../src/utils/browserCookies'),
  openPeopleForceLogin: jest.fn(),
  getPeopleForceSessionCookie: jest.fn(),
}));

const mockedPromptText = promptText as jest.Mock;
const mockedPromptList = promptList as jest.Mock;
const mockedPromptConfirm = promptConfirm as jest.Mock;
const mockedPromptPassword = promptPassword as jest.Mock;
const mockedOpenLogin = openPeopleForceLogin as jest.Mock;
const mockedGetCookie = getPeopleForceSessionCookie as jest.Mock;
const MockedPeopleForceClient = PeopleForceClient as jest.Mock;

const BASE_URL = 'https://co.peopleforce.io';

let testConnection: jest.Mock;

beforeEach(() => {
  // clearAllMocks (not resetAllMocks) — resetAllMocks would also wipe out the
  // withSpinner passthrough implementation set in the jest.mock factory above.
  jest.clearAllMocks();
  testConnection = jest.fn().mockResolvedValue(undefined);
  MockedPeopleForceClient.mockImplementation(() => ({ testConnection }));
  mockedOpenLogin.mockImplementation(() => undefined);
  // Also exercises the inline URL validator (both branches) the same way
  // inquirer itself would call it while the user types.
  mockedPromptText.mockImplementation(
    async (_msg: string, _def: string, validate?: (v: string) => boolean | string) => {
      if (validate) {
        validate('not-a-url');
        validate(BASE_URL);
      }
      return BASE_URL;
    }
  );

  // "Press Enter once you are logged in" always resolves true; other confirm()
  // calls are set per-test.
  mockedPromptConfirm.mockImplementation((message: string) => {
    if (message.includes('Press Enter')) return Promise.resolve(true);
    return Promise.resolve(true);
  });
});

describe('promptPeopleForceSetup', () => {
  it('opens the login page and returns a manual cookie on first successful verify', async () => {
    mockedPromptList.mockResolvedValueOnce('manual'); // mode
    // Also exercises the inline "cannot be empty" validator (both branches).
    mockedPromptPassword.mockImplementation(
      async (_msg: string, validate?: (v: string) => boolean | string) => {
        if (validate) {
          validate('');
          validate('cookie-value-1');
        }
        return 'cookie-value-1';
      }
    );

    const result = await promptPeopleForceSetup();

    expect(mockedOpenLogin).toHaveBeenCalledWith(BASE_URL);
    expect(result).toEqual({ baseUrl: BASE_URL, manualCookie: 'cookie-value-1' });
    expect(testConnection).toHaveBeenCalledTimes(1);
  });

  it('returns null when manual verification keeps failing and the user declines to retry', async () => {
    mockedPromptList.mockResolvedValueOnce('manual');
    mockedPromptPassword.mockResolvedValue('bad-cookie');
    testConnection.mockRejectedValue(new Error('401'));
    mockedPromptConfirm.mockImplementation((message: string) => {
      if (message.includes('Press Enter')) return Promise.resolve(true);
      if (message.includes('Try pasting again')) return Promise.resolve(false);
      return Promise.resolve(true);
    });

    const result = await promptPeopleForceSetup();

    expect(result).toBeNull();
  });

  it('auto-detects the browser cookie and verifies successfully', async () => {
    mockedPromptList.mockResolvedValueOnce('auto').mockResolvedValueOnce('chrome'); // mode, browser
    mockedGetCookie.mockResolvedValue('session=abc123');

    const result = await promptPeopleForceSetup();

    expect(result).toEqual({ baseUrl: BASE_URL, browser: 'chrome' });
    expect(mockedGetCookie).toHaveBeenCalledWith('chrome', BASE_URL);
  });

  it('falls back to manual paste when the OS denies cookie access', async () => {
    mockedPromptList.mockResolvedValueOnce('auto').mockResolvedValueOnce('firefox');
    mockedGetCookie.mockRejectedValue(new CookieAccessDeniedError('denied'));
    mockedPromptPassword.mockResolvedValueOnce('manual-fallback-cookie');

    const result = await promptPeopleForceSetup();

    expect(result).toEqual({ baseUrl: BASE_URL, manualCookie: 'manual-fallback-cookie' });
  });

  it('retries auto-detect when no cookie is found, then gives up to manual paste', async () => {
    mockedPromptList.mockResolvedValueOnce('auto').mockResolvedValueOnce('zen');
    mockedGetCookie.mockResolvedValue(null);
    mockedPromptConfirm.mockImplementation((message: string) => {
      if (message.includes('Press Enter')) return Promise.resolve(true);
      if (message.includes('Try again')) return Promise.resolve(true);
      return Promise.resolve(true);
    });
    mockedPromptPassword.mockResolvedValueOnce('final-manual-cookie');

    const result = await promptPeopleForceSetup();

    expect(mockedGetCookie).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ baseUrl: BASE_URL, manualCookie: 'final-manual-cookie' });
  });

  it('returns null after exhausting all manual-paste attempts without ever declining', async () => {
    mockedPromptList.mockResolvedValueOnce('manual');
    mockedPromptPassword.mockResolvedValue('always-bad-cookie');
    testConnection.mockRejectedValue(new Error('401'));
    mockedPromptConfirm.mockImplementation((message: string) => {
      if (message.includes('Press Enter')) return Promise.resolve(true);
      if (message.includes('Try pasting again')) return Promise.resolve(true);
      return Promise.resolve(true);
    });

    const result = await promptPeopleForceSetup();

    expect(result).toBeNull();
    expect(testConnection).toHaveBeenCalledTimes(3);
  });

  it('propagates unexpected (non-access-denied) errors from the cookie read instead of swallowing them', async () => {
    mockedPromptList.mockResolvedValueOnce('auto').mockResolvedValueOnce('chrome');
    mockedGetCookie.mockRejectedValue(new Error('unexpected disk error'));

    await expect(promptPeopleForceSetup()).rejects.toThrow('unexpected disk error');
  });

  it('returns null when auto-detect finds a cookie but verification fails and retry is declined', async () => {
    mockedPromptList.mockResolvedValueOnce('auto').mockResolvedValueOnce('edge');
    mockedGetCookie.mockResolvedValue('session=stale');
    testConnection.mockRejectedValue(new Error('expired'));
    mockedPromptConfirm.mockImplementation((message: string) => {
      if (message.includes('Press Enter')) return Promise.resolve(true);
      if (message.includes('Try again')) return Promise.resolve(false);
      return Promise.resolve(true);
    });

    const result = await promptPeopleForceSetup();

    expect(result).toBeNull();
  });
});
