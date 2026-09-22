import { ensureDyceAutoReauthNotice } from '../../src/utils/dyceAutoReauthNotice';
import { loadConfig, saveConfig } from '../../src/config/manager';
import { configureDyceSilentReauth } from '../../src/utils/dyceSilentReauthSetup';
import { Config } from '../../src/config/schema';

jest.mock('../../src/ui/prompts', () => ({ printHint: jest.fn() }));
jest.mock('../../src/config/manager', () => ({
  loadConfig: jest.fn(),
  saveConfig: jest.fn(),
}));
jest.mock('../../src/utils/dyceSilentReauthSetup', () => ({
  configureDyceSilentReauth: jest.fn(),
}));

const mockedLoadConfig = loadConfig as jest.Mock;
const mockedSaveConfig = saveConfig as jest.Mock;
const mockedConfigureDyceSilentReauth = configureDyceSilentReauth as jest.Mock;

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    tempo: { token: 't', baseUrl: 'https://api.eu.tempo.io', accountId: 'acc' },
    jira: { baseUrl: 'https://co.atlassian.net', email: 'a@b.com', token: 'j' },
    dyce: {
      clientId: 'client-id',
      scope: 'scope',
      refreshToken: 'refresh',
      instance: 'inst',
      company: 'co',
      resourceNo: 'EMP01',
    },
    mappings: [],
    vacationPrefixes: [],
    schemaVersion: 2,
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedLoadConfig.mockImplementation(() => baseConfig());
  mockedConfigureDyceSilentReauth.mockResolvedValue(undefined);
});

describe('ensureDyceAutoReauthNotice', () => {
  it('skips when dyce.browser is already configured', async () => {
    const config = baseConfig({ dyce: { ...baseConfig().dyce, browser: 'chrome' } });
    const result = await ensureDyceAutoReauthNotice(config);
    expect(result).toBe(config);
    expect(mockedConfigureDyceSilentReauth).not.toHaveBeenCalled();
  });

  it('skips when peopleforce.browser fallback is already configured', async () => {
    const config = baseConfig({
      peopleforce: { baseUrl: 'https://co.peopleforce.io', browser: 'firefox' },
    });
    const result = await ensureDyceAutoReauthNotice(config);
    expect(result).toBe(config);
    expect(mockedConfigureDyceSilentReauth).not.toHaveBeenCalled();
  });

  it('skips when the notice was already shown', async () => {
    const config = baseConfig({ dyceAutoReauthNoticeShown: true });
    const result = await ensureDyceAutoReauthNotice(config);
    expect(result).toBe(config);
    expect(mockedConfigureDyceSilentReauth).not.toHaveBeenCalled();
  });

  it('walks the user through setup and marks the notice shown', async () => {
    const config = baseConfig();
    const result = await ensureDyceAutoReauthNotice(config);
    expect(mockedConfigureDyceSilentReauth).toHaveBeenCalledWith('client-id', 'scope');
    expect(result.dyceAutoReauthNoticeShown).toBe(true);
    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ dyceAutoReauthNoticeShown: true })
    );
  });

  it('persists on top of a freshly loaded config so configureDyceSilentReauth writes survive', async () => {
    mockedConfigureDyceSilentReauth.mockImplementation(async () => {
      // Simulate the setup helper having already saved dyce.browser itself.
      mockedLoadConfig.mockImplementation(() =>
        baseConfig({ dyce: { ...baseConfig().dyce, browser: 'zen' } })
      );
    });
    const config = baseConfig();
    const result = await ensureDyceAutoReauthNotice(config);
    expect(result.dyce.browser).toBe('zen');
    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ dyceAutoReauthNoticeShown: true, dyce: expect.objectContaining({ browser: 'zen' }) })
    );
  });
});
