import { ensureLeaveProviderNotice } from '../../src/utils/leaveProviderNotice';
import { promptList } from '../../src/ui/prompts';
import { loadConfig, saveConfig } from '../../src/config/manager';
import { promptPeopleForceSetup } from '../../src/utils/peopleforceSetup';
import { Config } from '../../src/config/schema';

jest.mock('../../src/ui/prompts', () => ({
  promptList: jest.fn(),
  printHint: jest.fn(),
}));
jest.mock('../../src/config/manager', () => ({
  loadConfig: jest.fn(),
  saveConfig: jest.fn(),
}));
jest.mock('../../src/utils/peopleforceSetup', () => ({
  promptPeopleForceSetup: jest.fn(),
}));

const mockedPromptList = promptList as jest.Mock;
const mockedLoadConfig = loadConfig as jest.Mock;
const mockedSaveConfig = saveConfig as jest.Mock;
const mockedPromptPeopleForceSetup = promptPeopleForceSetup as jest.Mock;

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
    paser: { baseUrl: 'https://app.paser.io', email: 'a@b.com', password: 'pw', accountId: 1 },
    mappings: [],
    vacationPrefixes: [],
    schemaVersion: 2,
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedLoadConfig.mockImplementation(() => baseConfig());
});

describe('ensureLeaveProviderNotice', () => {
  it('returns config unchanged when no paser is configured', async () => {
    const config = baseConfig({ paser: undefined });
    const result = await ensureLeaveProviderNotice(config);
    expect(result).toBe(config);
    expect(mockedPromptList).not.toHaveBeenCalled();
  });

  it('returns config unchanged when leaveProvider is already set', async () => {
    const config = baseConfig({ leaveProvider: 'paser' });
    const result = await ensureLeaveProviderNotice(config);
    expect(result).toBe(config);
    expect(mockedPromptList).not.toHaveBeenCalled();
  });

  it('returns config unchanged when the notice was already shown', async () => {
    const config = baseConfig({ peopleforceNoticeShown: true });
    const result = await ensureLeaveProviderNotice(config);
    expect(result).toBe(config);
    expect(mockedPromptList).not.toHaveBeenCalled();
  });

  it('"Still using Paser" sets leaveProvider and marks the notice shown', async () => {
    mockedPromptList.mockResolvedValue('paser');
    const config = baseConfig();
    const result = await ensureLeaveProviderNotice(config);
    expect(result.leaveProvider).toBe('paser');
    expect(result.peopleforceNoticeShown).toBe(true);
    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ leaveProvider: 'paser', peopleforceNoticeShown: true })
    );
  });

  it('"Skip for now" leaves config untouched and does not save, so it asks again next run', async () => {
    mockedPromptList.mockResolvedValue('skip');
    const config = baseConfig();
    const result = await ensureLeaveProviderNotice(config);
    expect(result).toBe(config);
    expect(result.leaveProvider).toBeUndefined();
    expect(result.peopleforceNoticeShown).toBeUndefined();
    expect(mockedSaveConfig).not.toHaveBeenCalled();
  });

  it('falls back to Paser and stops nagging when PeopleForce setup fails/declines', async () => {
    mockedPromptList.mockResolvedValue('peopleforce');
    mockedPromptPeopleForceSetup.mockResolvedValue(null);
    const config = baseConfig();
    const result = await ensureLeaveProviderNotice(config);
    expect(result.leaveProvider).toBe('paser');
    expect(result.peopleforceNoticeShown).toBe(true);
    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ leaveProvider: 'paser', peopleforceNoticeShown: true })
    );
  });

  it('switches to PeopleForce when setup succeeds', async () => {
    mockedPromptList.mockResolvedValue('peopleforce');
    const pfResult = { baseUrl: 'https://co.peopleforce.io', browser: 'chrome' as const };
    mockedPromptPeopleForceSetup.mockResolvedValue(pfResult);
    const config = baseConfig();
    const result = await ensureLeaveProviderNotice(config);
    expect(result.leaveProvider).toBe('peopleforce');
    expect(result.peopleforce).toEqual(pfResult);
    expect(result.peopleforceNoticeShown).toBe(true);
  });

  it('saves against a freshly loaded config, not the stale passed-in snapshot', async () => {
    mockedPromptList.mockResolvedValue('paser');
    // Simulate something else having changed config on disk in between.
    mockedLoadConfig.mockImplementation(() => baseConfig({ dyceAutoReauthNoticeShown: true }));
    const staleConfig = baseConfig();
    const result = await ensureLeaveProviderNotice(staleConfig);
    expect(result.dyceAutoReauthNoticeShown).toBe(true);
    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ dyceAutoReauthNoticeShown: true, leaveProvider: 'paser' })
    );
  });
});
