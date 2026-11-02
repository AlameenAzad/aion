import { resolveDyceBrowser } from '../../src/utils/dyceBrowser';

describe('resolveDyceBrowser', () => {
  it('returns undefined when neither dyce nor peopleforce has a browser', () => {
    expect(resolveDyceBrowser({ dyce: {} })).toBeUndefined();
    expect(resolveDyceBrowser({ dyce: {}, peopleforce: {} })).toBeUndefined();
  });

  it("prefers dyce's browser and profile", () => {
    expect(
      resolveDyceBrowser({
        dyce: { browser: 'helium', browserProfile: 'Profile 3' },
        peopleforce: { browser: 'chrome', browserProfile: 'Profile 9' },
      })
    ).toEqual({ browser: 'helium', profile: 'Profile 3' });
  });

  it("does not borrow peopleforce's profile when dyce sets its own browser", () => {
    expect(
      resolveDyceBrowser({
        dyce: { browser: 'helium' },
        peopleforce: { browser: 'helium', browserProfile: 'Profile 9' },
      })
    ).toEqual({ browser: 'helium', profile: undefined });
  });

  it("falls back to peopleforce's browser and profile together", () => {
    expect(
      resolveDyceBrowser({
        dyce: {},
        peopleforce: { browser: 'edge', browserProfile: 'Profile 1' },
      })
    ).toEqual({ browser: 'edge', profile: 'Profile 1' });
  });
});
