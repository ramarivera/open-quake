import { expect, it } from "vitest";
import { isHoldToTalkKey } from "../../../edge/src/voice/surface/voice-surface-invariants.js";
import { previewLegacyAssistant } from "./assistant-legacy.js";
it("AI-089 preserves inert imports until reviewed, retaining only portable persona choices", () => {
 const raw = { aiModelType: "legacy-model", enableWakeTalkWindow: true, enableVoiceInput: true, chatHistoryCount: 4, useCustomPrompt: true, systemPrompt: "Translate", roleTemperature: 0.5, roleTopP: 0.6, apiKey: "do-not-copy", customUrlAddr: "https://do-not-copy.invalid", homeAssistantControl: true };
 const key = { type: "aiChat", actions: [], aiConfigData: raw };
 expect(isHoldToTalkKey(key)).toBe(false);
 const reviewed = previewLegacyAssistant(JSON.stringify(raw));
 expect(reviewed).toMatchObject({ modelId: "legacy-model", enableWakeTalkWindow: true, useAgent: false, homeAssistantControl: false, roleId: -1, customPrompt: "Translate", chatHistoryCount: 4, temperature: 0.5, topP: 0.6 });
 expect(JSON.stringify(reviewed)).not.toContain("do-not-copy");
 expect(isHoldToTalkKey({ ...key, assistantSettings: reviewed })).toBe(true);
 expect(raw.apiKey).toBe("do-not-copy");
});
