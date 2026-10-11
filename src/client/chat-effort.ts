import { CHAT_EFFORTS, type ChatEffort } from "../shared/contracts";

const STORAGE_KEY = "sparklingkit:chat-effort";
// "high" asks for thinking at the model's own default effort, which is what chat did before the control existed.
const DEFAULT_EFFORT: ChatEffort = "high";

export const EFFORT_LABELS: Record<ChatEffort, string> = { off: "Off", low: "Low", medium: "Medium", high: "High" };

export function readChatEffort(): ChatEffort {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return (CHAT_EFFORTS as readonly string[]).includes(stored || "") ? (stored as ChatEffort) : DEFAULT_EFFORT;
  } catch {
    return DEFAULT_EFFORT;
  }
}

export function saveChatEffort(effort: ChatEffort) {
  try {
    window.localStorage.setItem(STORAGE_KEY, effort);
  } catch {
    // Private windows and blocked storage keep the choice for this page only.
  }
}

// Friendly names for the model ids this fork's DGX backends serve; any other id is shown as configured.
const MODEL_LABELS: Record<string, string> = {
  "saluki-27b": "Saluki 27B",
};

export function modelLabel(model?: string) {
  return model ? MODEL_LABELS[model] || model : "";
}
