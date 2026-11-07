import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_MESSAGES_PER_MINUTE,
  DEFAULT_CHAT_MODEL,
  detectSensitiveEmergency,
  isUuid,
  makeAssistantSystemPrompt,
  makeChatReference,
  redactChatPromptText,
  remainingChatSeconds
} from "../src/lib/chat-rules.mjs";

test("preview time is calculated from server timestamps and never becomes negative", () => {
  assert.equal(remainingChatSeconds("2026-11-07T00:02:00.000Z", "2026-11-07T00:00:00.001Z"), 120);
  assert.equal(remainingChatSeconds("2026-11-07T00:00:00.000Z", "2026-11-07T00:00:00.001Z"), 0);
});

test("chat input and rate limits are bounded", () => {
  assert.equal(CHAT_MESSAGE_MAX_LENGTH, 2000);
  assert.equal(CHAT_MESSAGES_PER_MINUTE, 8);
});

test("sensitive safety language routes to a human without relying on the model", () => {
  assert.equal(detectSensitiveEmergency("I want to hurt myself"), "urgent");
  assert.equal(detectSensitiveEmergency("मुझे आत्महत्या के विचार आ रहे हैं"), "urgent");
  assert.equal(detectSensitiveEmergency("mujhe khudkushi ka khayal aa raha hai"), "urgent");
  assert.equal(detectSensitiveEmergency("How can I apply for a scholarship?"), null);
});

test("AI context redacts contact identifiers and prompt includes limits", () => {
  const redacted = redactChatPromptText("Email me at person@example.com; my number is 9876543210 and ID 123456789012");
  assert.doesNotMatch(redacted, /person@example\.com|9876543210|123456789012/);
  const prompt = makeAssistantSystemPrompt("Student Help");
  assert.match(prompt, /not a complete consultation/);
  assert.match(prompt, /untrusted input/);
  assert.equal(DEFAULT_CHAT_MODEL, "@cf/google/gemma-4-26b-a4b-it");
});

test("session IDs validate and helpdesk references use a restricted alphabet", () => {
  assert.equal(isUuid("d9428888-122b-4cfa-8b3d-7e1b7b6a5e11"), true);
  assert.equal(isUuid("not-an-id"), false);
  const reference = makeChatReference();
  assert.match(reference, /^HMD-H-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
});
