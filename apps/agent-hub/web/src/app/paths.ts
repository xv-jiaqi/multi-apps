export type TaskTab = 'output' | 'diff' | 'approvals' | 'info';
export type SettingsSection = 'agents' | 'repos' | 'bot' | 'tokens' | 'general' | 'data' | 'about';

const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'agents',
  'repos',
  'bot',
  'tokens',
  'general',
  'data',
  'about',
];

export const paths = {
  home(): string {
    return '/';
  },
  task(taskId: string, tab?: TaskTab): string {
    if (!tab || tab === 'output') return `/tasks/${encodeURIComponent(taskId)}`;
    return `/tasks/${encodeURIComponent(taskId)}?tab=${tab}`;
  },
  newTask(): string {
    return '/new';
  },
  settings(section?: SettingsSection): string {
    if (!section || section === 'agents') return '/settings';
    return `/settings/${section}`;
  },
};

export function parseTaskTab(value: string | null): TaskTab {
  if (value === 'diff' || value === 'approvals' || value === 'info') return value;
  return 'output';
}

export function parseSettingsSection(value: string | undefined): SettingsSection {
  if (value && isSettingsSection(value)) return value;
  return 'agents';
}

export function isSettingsSection(value: string): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section === value);
}
