import { promptList, printHint } from '../ui/prompts';
import { Config } from '../config/schema';
import { loadConfig, saveConfig } from '../config/manager';
import { promptPeopleForceSetup } from './peopleforceSetup';

/**
 * One-time, non-blocking notice for existing Paser users: PeopleForce is now
 * available as an alternative. Shown once (peopleforceNoticeShown), never
 * repeated, and never forces a migration — declining leaves config.paser and
 * leaveProvider exactly as they were.
 */
export async function ensureLeaveProviderNotice(config: Config): Promise<Config> {
  if (!config.paser || config.leaveProvider || config.peopleforceNoticeShown) {
    return config;
  }

  console.log();
  printHint('aion now supports PeopleForce as a leave provider alongside Paser.');

  const choice = await promptList<'paser' | 'peopleforce' | 'skip'>(
    'Still using Paser, or want to switch to PeopleForce?',
    [
      { name: 'Still using Paser', value: 'paser' },
      { name: 'Switch to PeopleForce', value: 'peopleforce' },
      { name: 'Skip for now (ask me later)', value: 'skip' },
    ]
  );

  if (choice === 'paser') {
    const updated: Config = { ...loadConfig(), leaveProvider: 'paser', peopleforceNoticeShown: true };
    saveConfig(updated);
    return updated;
  }

  if (choice === 'skip') {
    // Deliberately don't set leaveProvider or peopleforceNoticeShown — this is
    // "ask me later", not "still using Paser". sync's Paser lookup already
    // falls back to config.paser when leaveProvider is unset, so Paser
    // matching keeps working in the meantime and the notice fires again next run.
    return config;
  }

  const result = await promptPeopleForceSetup();
  if (!result) {
    // Verification failed or was declined — keep using Paser, don't nag again.
    const updated: Config = {
      ...loadConfig(),
      leaveProvider: 'paser',
      peopleforceNoticeShown: true,
    };
    saveConfig(updated);
    return updated;
  }

  const updated: Config = {
    ...loadConfig(),
    leaveProvider: 'peopleforce',
    peopleforce: result,
    peopleforceNoticeShown: true,
  };
  saveConfig(updated);
  return updated;
}
