import { ConfigSchema, DyceMappingSchema, DyceLeaveMappingSchema } from '../../src/config/schema';
import { migrateRawConfig } from '../../src/config/manager';

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
  paser: {
    baseUrl: 'https://app.paser.io',
    email: 'dev@company.com',
    password: 'secret123',
    accountId: 90,
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

  it('accepts config without Paser credentials', () => {
    const { paser: _, ...cfg } = validConfig;
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

  it('rejects invalid Paser baseUrl', () => {
    const bad = { ...validConfig, paser: { ...validConfig.paser, baseUrl: 'not-url' } };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects invalid Paser email', () => {
    const bad = { ...validConfig, paser: { ...validConfig.paser, email: 'invalid' } };
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

  it('accepts config with leaveTypeMappings', () => {
    const cfg = {
      ...validConfig,
      leaveTypeMappings: {
        vacation: {
          label: 'Annual Leave',
          dyce: { customerNo: 'C001', jobNo: 'J-VAC', jobTaskNo: 'T-VAC' },
        },
        sickLeave: { dyce: { customerNo: 'C001', jobNo: 'J-SICK', jobTaskNo: 'T-SICK' } },
        publicHoliday: { dyce: { customerNo: 'C001', jobNo: 'J-HOL', jobTaskNo: 'T-HOL' } },
      },
    };
    expect(ConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it('accepts config with partial leaveTypeMappings (only vacation)', () => {
    const cfg = {
      ...validConfig,
      leaveTypeMappings: {
        vacation: { dyce: { customerNo: 'C001', jobNo: 'J-VAC', jobTaskNo: 'T-VAC' } },
      },
    };
    expect(ConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it('accepts config without leaveTypeMappings (backward-compatible)', () => {
    expect(ConfigSchema.safeParse(validConfig).success).toBe(true);
  });
});

// ── DyceLeaveMappingSchema ────────────────────────────────────────────────────

describe('DyceLeaveMappingSchema', () => {
  it('accepts a minimal leave mapping', () => {
    const m = { dyce: { customerNo: 'C001', jobNo: 'J001', jobTaskNo: 'T001' } };
    expect(DyceLeaveMappingSchema.safeParse(m).success).toBe(true);
  });

  it('accepts an optional label', () => {
    const m = { label: 'Vacation', dyce: { customerNo: 'C001', jobNo: 'J001', jobTaskNo: 'T001' } };
    expect(DyceLeaveMappingSchema.safeParse(m).success).toBe(true);
  });

  it('rejects a missing customerNo', () => {
    const bad = { dyce: { jobNo: 'J001', jobTaskNo: 'T001' } };
    expect(DyceLeaveMappingSchema.safeParse(bad).success).toBe(false);
  });
});

// ── schemaVersion + migrateRawConfig ─────────────────────────────────────────

describe('schemaVersion', () => {
  it('defaults schemaVersion to 1 when not present in config', () => {
    const result = ConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe(1);
    }
  });

  it('accepts config that explicitly sets schemaVersion: 1', () => {
    const result = ConfigSchema.safeParse({ ...validConfig, schemaVersion: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe(1);
    }
  });

  it('rejects non-integer schemaVersion', () => {
    const result = ConfigSchema.safeParse({ ...validConfig, schemaVersion: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe('migrateRawConfig', () => {
  it('stamps schemaVersion: 1 on objects without it', () => {
    const input = { foo: 'bar' };
    const output = migrateRawConfig(input) as Record<string, unknown>;
    expect(output.schemaVersion).toBe(1);
  });

  it('does not overwrite an existing schemaVersion', () => {
    const input = { foo: 'bar', schemaVersion: 1 };
    const output = migrateRawConfig(input) as Record<string, unknown>;
    expect(output.schemaVersion).toBe(1);
  });

  it('returns non-object values unchanged', () => {
    expect(migrateRawConfig(null)).toBeNull();
    expect(migrateRawConfig('string')).toBe('string');
    expect(migrateRawConfig(42)).toBe(42);
  });
});
