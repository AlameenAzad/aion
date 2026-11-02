import { promptBrowserProfile } from '../../src/utils/browserProfilePrompt';
import { promptList } from '../../src/ui/prompts';
import { listBrowserProfiles } from '../../src/utils/browserCookies';

jest.mock('../../src/ui/prompts', () => ({ promptList: jest.fn() }));
jest.mock('../../src/utils/browserCookies', () => ({ listBrowserProfiles: jest.fn() }));

const mockedPromptList = promptList as jest.Mock;
const mockedListProfiles = listBrowserProfiles as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('promptBrowserProfile', () => {
  it('skips the prompt when there is nothing to choose between', async () => {
    mockedListProfiles.mockReturnValue([{ dir: 'Default', name: 'Your Helium' }]);
    expect(await promptBrowserProfile('helium')).toBeUndefined();
    mockedListProfiles.mockReturnValue([]);
    expect(await promptBrowserProfile('firefox')).toBeUndefined();
    expect(mockedPromptList).not.toHaveBeenCalled();
  });

  it('offers auto plus each profile by display name and returns the chosen directory', async () => {
    mockedListProfiles.mockReturnValue([
      { dir: 'Default', name: 'Your Helium' },
      { dir: 'Profile 3', name: 'Informa' },
      { dir: 'Profile 5', name: 'Profile 5' },
    ]);
    mockedPromptList.mockResolvedValue('Profile 3');

    expect(await promptBrowserProfile('helium', '(hint)')).toBe('Profile 3');

    const [message, choices] = mockedPromptList.mock.calls[0];
    expect(message).toContain('helium');
    expect(message).toContain('(hint)');
    expect(choices.map((c: { name: string }) => c.name)).toEqual([
      expect.stringContaining('Auto'),
      'Your Helium (Default)',
      'Informa (Profile 3)',
      'Profile 5',
    ]);
  });

  it('returns undefined when the user picks auto', async () => {
    mockedListProfiles.mockReturnValue([
      { dir: 'Default', name: 'A' },
      { dir: 'Profile 1', name: 'B' },
    ]);
    mockedPromptList.mockImplementation(async (_m, choices) => choices[0].value);
    expect(await promptBrowserProfile('chrome')).toBeUndefined();
  });
});
