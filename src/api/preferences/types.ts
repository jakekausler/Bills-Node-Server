export interface TabPreference {
  hiddenTabs: string[];
  tabOrder: string[];
}

export interface UserPreferences {
  hiddenPages: string[];
  pinnedPages: string[];
  tabPreferences: Record<string, TabPreference>;
}
