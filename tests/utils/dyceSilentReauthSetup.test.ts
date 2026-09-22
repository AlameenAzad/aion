import { configureDyceSilentReauth } from '../../src/utils/dyceSilentReauthSetup';
import { promptList, promptConfirm } from '../../src/ui/prompts';
import { loadConfig, saveConfig } from '../../src/config/manager';
import { silentlyReauthenticateDyce } from '../../src/api/msauth';
import { Config } from '../../src/config/schema';

jest.mock('../../src/ui/prompts', () => ({
  promptList: jest.fn(),
  promptConfirm: jest.fn(),
  printSuccess: jest.fn(),
  printWarning: jest.fn(),
}));
jest.mock('../../src/ui/banner', () => ({ showInfoBox: jest.fn() }));
jest.mock('../../src/ui/spinner', () => ({
  withSpinner: jest.fn((_text: string, fn: () => unknown) => fn()),
}));
jest.mock('../../src/config/manager', () => ({
  loadConfig: jest.fn(),
  saveConfig: jest.fn(),
}));
jest.mock('../../src/api/msauth', () => ({
  silentlyReauthenticateDyce: jest.fn(),
}));

const mockedPromptList = promptList as jest.Mock;
const mockedPromptConfirm = promptConfirm as jest.Mock;
const mockedLoadConfig = loadConfig as jest.Mock;
const mockedSaveConfig = saveConfig as jest.Mock;
const mockedSilentlyReauthenticateDyce = silentlyReauthenticateDyce as jest.Mock;

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
  // clearAllMocks (not resetAllMocks) — resetAllMocks would also wipe out the
  // withSpinner passthrough implementation set in the jest.mock factory above.
  jest.clearAllMocks();
});

describe('configureDyceSilentReauth', () => {
  it('sets an explicit disable flag when declined, leaving peopleforce.browser untouched', async () => {
    mockedLoadConfig.mockReturnValue(
      baseConfig({ peopleforce: { baseUrl: 'https://co.peopleforce.io', browser: 'firefox' } })
    );
    mockedPromptConfirm.mockResolvedValue(false);

    await configureDyceSilentReauth('client-id', 'scope');

    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        dyce: expect.objectContaining({ silentReauthDisabled: true }),
        peopleforce: expect.objectContaining({ browser: 'firefox' }),
      })
    );
    expect(mockedPromptList).not.toHaveBeenCalled();
  });

  it('defaults the confirm prompt to false when nothing is configured yet', async () => {
    mockedLoadConfig.mockReturnValue(baseConfig());
    mockedPromptConfirm.mockResolvedValue(false);

    await configureDyceSilentReauth('client-id', 'scope');

    expect(mockedPromptConfirm).toHaveBeenCalledWith(expect.any(String), false);
  });

  it('defaults the confirm prompt to true when already enabled via dyce.browser', async () => {
    mockedLoadConfig.mockReturnValue(
      baseConfig({ dyce: { ...baseConfig().dyce, browser: 'chrome' } })
    );
    mockedPromptConfirm.mockResolvedValue(true);
    mockedPromptList.mockResolvedValue('chrome');
    mockedSilentlyReauthenticateDyce.mockResolvedValue(null);

    await configureDyceSilentReauth('client-id', 'scope');

    expect(mockedPromptConfirm).toHaveBeenCalledWith(expect.any(String), true);
  });

  it('treats silentReauthDisabled as not-enabled even when a browser is set', async () => {
    mockedLoadConfig.mockReturnValue(
      baseConfig({ dyce: { ...baseConfig().dyce, browser: 'chrome', silentReauthDisabled: true } })
    );
    mockedPromptConfirm.mockResolvedValue(false);

    await configureDyceSilentReauth('client-id', 'scope');

    expect(mockedPromptConfirm).toHaveBeenCalledWith(expect.any(String), false);
  });

  it('persists the freshly minted token pair on successful verification', async () => {
    mockedLoadConfig.mockReturnValue(baseConfig());
    mockedPromptConfirm.mockResolvedValue(true);
    mockedPromptList.mockResolvedValue('zen');
    mockedSilentlyReauthenticateDyce.mockResolvedValue({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    await configureDyceSilentReauth('client-id', 'scope');

    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        dyce: expect.objectContaining({
          browser: 'zen',
          token: 'new-access',
          refreshToken: 'new-refresh',
          silentReauthDisabled: undefined,
        }),
      })
    );
  });

  it('still saves the browser choice when verification finds no active SSO session', async () => {
    mockedLoadConfig.mockReturnValue(baseConfig());
    mockedPromptConfirm.mockResolvedValue(true);
    mockedPromptList.mockResolvedValue('brave');
    mockedSilentlyReauthenticateDyce.mockResolvedValue(null);

    await configureDyceSilentReauth('client-id', 'scope');

    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ dyce: expect.objectContaining({ browser: 'brave' }) })
    );
    const saved = mockedSaveConfig.mock.calls[0][0];
    expect(saved.dyce.token).toBeUndefined();
  });

  it('still saves the browser choice when verification throws', async () => {
    mockedLoadConfig.mockReturnValue(baseConfig());
    mockedPromptConfirm.mockResolvedValue(true);
    mockedPromptList.mockResolvedValue('edge');
    mockedSilentlyReauthenticateDyce.mockRejectedValue(new Error('network down'));

    await configureDyceSilentReauth('client-id', 'scope');

    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ dyce: expect.objectContaining({ browser: 'edge' }) })
    );
  });
});
