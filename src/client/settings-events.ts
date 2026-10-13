import type { Settings } from "./types";

export const settingsUpdatedEvent = "sparkfire:settings-updated";

export function announceSettingsUpdated(settings: Settings) {
  window.dispatchEvent(new CustomEvent<Settings>(settingsUpdatedEvent, { detail: settings }));
}
