import { ConfigSchema, DyceMappingSchema } from '../../src/config/schema';

const validMapping = {
  jiraProjectKey: 'PROJ',
  dyce: {
    customerNo: 'C001',
    jobNo: 'J001',
    jobTaskNo: 'T001',
  },
};

const validConfig = {
  tempo: {
    token: 'tempo-token-abc',
    baseUrl: 'https://api.eu.tempo.io',
    accountId: 'abc123',
  },
  jira: {
    baseUrl: 'https://mycompany.atlassian.net',
    email: 'dev@company.com',
    token: 'jira-token-xyz',
  },
  dyce: {
    clientId: 'azure-client-id',
    scope: 'api://dyce/.default offline_access',
    token: 'eyABCxyz',
    refreshToken: 'eyRefreshToken',
    instance: 'my-instance',
    company: 'my-company',
    resourceNo: 'EMP001',
  },
  mappings: [validMapping],
  vacationPrefixes: ['VAC', 'SICK'],
  publicHolidayDescription: 'Government approved official holiday',
};

// ── DyceMappingSchema ─────────────────────────────────────────────────────────

describe('DyceMappingSchema', () => {
  it('accepts a minimal valid mapping', () => {
    expect(DyceMappingSchema.safeParse(validMapping).success).toBe(true);
  });

  it('accepts optional fields (label, IDs)', () => {
    const full = {
      ...validMapping,
      label: 'Backend Work',
      dyce: {
        ...validMapping.dyce,
        customerId: 'uuid-1',
        customerName: 'Acme Corp',
        jobId: 'uuid-2',
        jobDescription: 'Backend project',
        jobTaskId: 'uuid-3',
        jobTaskDescription: 'Development',
      },
    };
    expect(DyceMappingSchema.safeParse(full).success).toBe(true);
  });

  it('rejects an empty jiraProjectKey', () => {
    const bad = { ...validMapping, jiraProjectKey: '' };
    expect(DyceMappingSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing customerNo', () => {
    const bad = { jiraProjectKey: 'PROJ', dyce: { jobNo: 'J1', jobTaskNo: 'T1' } };
    expect(DyceMappingSchema.safeParse(bad).success).toBe(false);
  });
});

// ── ConfigSchema ──────────────────────────────────────────────────────────────

describe('ConfigSchema', () => {
  it('accepts a fully valid config', () => {
    expect(ConfigSchema.safeParse(validConfig).success).toBe(true);
  });

  it('accepts config with no mappings', () => {
    const cfg = { ...validConfig, mappings: [] };
    expect(ConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it('accepts config with no vacation prefixes', () => {
    const cfg = { ...validConfig, vacationPrefixes: [] };
    expect(ConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it('accepts config without a public holiday description', () => {
    const { publicHolidayDescription: _, ...cfg } = validConfig;
    expect(ConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it('accepts optional dyce fields (resourceId, resourceName)', () => {
    const cfg = {
      ...validConfig,
      dyce: { ...validConfig.dyce, resourceId: 'uuid-res', resourceName: 'Alice' },
    };
    expect(ConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it('accepts dyce config without a cached token (token is optional)', () => {
    const { token: _, ...dyceWithout } = validConfig.dyce;
    const cfg = { ...validConfig, dyce: dyceWithout };
    expect(ConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it('rejects dyce config missing clientId', () => {
    const { clientId: _, ...dyceWithout } = validConfig.dyce;
    const bad = { ...validConfig, dyce: dyceWithout };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects dyce config missing refreshToken', () => {
    const { refreshToken: _, ...dyceWithout } = validConfig.dyce;
    const bad = { ...validConfig, dyce: dyceWithout };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an invalid Jira base URL', () => {
    const bad = { ...validConfig, jira: { ...validConfig.jira, baseUrl: 'not-a-url' } };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an invalid email address', () => {
    const bad = { ...validConfig, jira: { ...validConfig.jira, email: 'not-an-email' } };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an invalid Tempo base URL', () => {
    // Zod url() accepts ftp:// but rejects clearly malformed strings
    const bad = { ...validConfig, tempo: { ...validConfig.tempo, baseUrl: 'not a url' } };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing dyce instance', () => {
    const { instance: _, ...dyceWithout } = validConfig.dyce;
    const bad = { ...validConfig, dyce: dyceWithout };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing tempo accountId', () => {
    const { accountId: _, ...tempoWithout } = validConfig.tempo;
    const bad = { ...validConfig, tempo: tempoWithout };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('strips unknown fields (Zod default strip behavior)', () => {
    const withExtra = { ...validConfig, unexpectedField: 'should be stripped' };
    const result = ConfigSchema.safeParse(withExtra);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).unexpectedField).toBeUndefined();
    }
  });
});
