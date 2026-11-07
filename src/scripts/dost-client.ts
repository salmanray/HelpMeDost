
function byId<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }
const log = byId<HTMLDivElement>("chat-log");
const categorySelect = byId<HTMLSelectElement>("category");
const timer = byId<HTMLElement>("timer");
const notice = byId<HTMLElement>("dost-notice");
const form = byId<HTMLFormElement>("chat-form");
const input = byId<HTMLTextAreaElement>("chat-message");
const sendButton = byId<HTMLButtonElement>("send-message");
const startPanel = byId<HTMLElement>("start-panel");
const startButton = byId<HTMLButtonElement>("start-chat");
const endedPanel = byId<HTMLElement>("ended-panel");
const humanPanel = byId<HTMLElement>("human-panel");
const typing = byId<HTMLElement>("typing");
const modePill = byId<HTMLElement>("mode-pill");
let session: Record<string, any> | null = null;
let countdownDeadline = 0;
let countdownId = 0;
let expired = false;

function addMessage(sender: string, text: string, createdAt?: string) {
  const bubble = document.createElement("div");
  bubble.className = "dost-message " + sender;
  bubble.append(document.createTextNode(text));
  const stamp = document.createElement("time");
  stamp.dateTime = createdAt || new Date().toISOString();
  stamp.textContent = new Date(createdAt || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  bubble.append(stamp); log.append(bubble); log.scrollTop = log.scrollHeight;
}
function setExpired() {
  if (expired) return;
  expired = true; clearInterval(countdownId); timer.textContent = "00:00";
  form.classList.add("hidden"); endedPanel.classList.remove("hidden");
  startPanel.classList.add("hidden"); input.disabled = true; modePill.textContent = "Preview ended";
}
function startCountdown(seconds: number) {
  clearInterval(countdownId);
  countdownDeadline = performance.now() + Math.max(0, seconds) * 1000;
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((countdownDeadline - performance.now()) / 1000));
    timer.textContent = String(Math.floor(remaining / 60)).padStart(2, "0") + ":" + String(remaining % 60).padStart(2, "0");
    if (!remaining) setExpired();
  };
  tick(); countdownId = window.setInterval(tick, 250);
}
function showHistory(messages: Array<{sender_type: string; message: string; created_at: string}>) {
  log.replaceChildren();
  for (const item of messages) addMessage(item.sender_type, item.message, item.created_at);
}
async function loadCategories() {
  const response = await fetch("/api/chat/categories", { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Dost AI is being prepared.");
  categorySelect.replaceChildren();
  for (const category of data.categories || []) {
    const option = document.createElement("option"); option.value = category.slug; option.textContent = category.name; categorySelect.append(option);
  }
}
async function loadSession() {
  const authResponse = await fetch("/api/auth/me", { cache: "no-store" });
  const auth = await authResponse.json().catch(() => ({}));
  if (!auth.authenticated || auth.user?.purpose !== "user" || auth.user?.user_type !== "public") {
    startPanel.innerHTML = '<p>Sign in to start your private free preview.</p><a class="button" href="/login?next=%2Fdost">Sign in to Dost AI →</a>';
    humanPanel.classList.add("hidden"); return;
  }
  await loadCategories();
  const response = await fetch("/api/chat/session", { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // A history read failure must not block a user from attempting to start a preview.
    notice.textContent = data.error || "Previous chat history is temporarily unavailable. You can still try starting a preview.";
    return;
  }
  if (!data.session) return;
  session = data.session as Record<string, any>; const loadedSession = session; categorySelect.value = loadedSession.category_slug; categorySelect.disabled = true;
  showHistory(data.messages || []); startPanel.classList.add("hidden");
  if (data.expired) setExpired(); else { form.classList.remove("hidden"); startCountdown(data.remainingSeconds); }
}
async function requestHuman() {
  const activeSession = session;
  if (!activeSession) { notice.textContent = "Start your preview first so we can attach the conversation."; return; }
  const candidates = [byId<HTMLButtonElement>("request-human-ended"), byId<HTMLButtonElement>("request-human")];
  candidates.forEach(item => { item.disabled = true; });
  notice.textContent = "Saving your Human Helpdesk request…";
  try {
    const response = await fetch("/api/chat/escalate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: activeSession.id }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not save your request.");
    notice.textContent = "Human Helpdesk request " + data.escalation.reference_code + " saved. Status: " + data.escalation.status + ". Staff response times can vary.";
    addMessage("system", "Your conversation was sent to the Human Helpdesk. Reference: " + data.escalation.reference_code, new Date().toISOString());
  } catch (error: any) { notice.textContent = error.message || "Could not save your request. Please retry."; }
  finally { candidates.forEach(item => { item.disabled = false; }); }
}
startButton?.addEventListener("click", async () => {
  startButton.disabled = true; notice.textContent = "Starting your private preview…";
  try {
    const response = await fetch("/api/chat/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: categorySelect.value }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not start your chat.");
    session = data.session as Record<string, any>; const createdSession = session; categorySelect.value = createdSession.category.slug; categorySelect.disabled = true;
    startPanel.classList.add("hidden"); form.classList.remove("hidden"); notice.textContent = ""; startCountdown(data.remainingSeconds);
    if (!data.isNew) {
      const historyResponse = await fetch("/api/chat/session/" + encodeURIComponent(createdSession.id), { cache: "no-store" });
      const history = await historyResponse.json().catch(() => ({}));
      if (historyResponse.ok) {
        showHistory(history.messages || []);
        if (history.expired) setExpired(); else startCountdown(history.remainingSeconds);
      } else {
        notice.textContent = history.error || "Previous messages could not be loaded, but you can continue if the preview is active.";
      }
    }
    input.focus();
  } catch (error: any) { notice.textContent = error.message || "Could not start your chat."; startButton.disabled = false; }
});
form?.addEventListener("submit", async event => {
  event.preventDefault(); const activeSession = session; if (!activeSession || expired) return;
  const message = input.value.trim(); if (!message) return;
  const clientMessageId = crypto.randomUUID(); sendButton.disabled = true; input.disabled = true; typing.classList.remove("hidden"); notice.textContent = "";
  try {
    const response = await fetch("/api/chat/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: activeSession.id, clientMessageId, message }) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 410) { setExpired(); notice.textContent = data.error; return; }
    if (!response.ok) throw new Error(data.error || "Message could not be sent.");
    if (!data.duplicate) { addMessage("user", data.userMessage.message, data.userMessage.created_at); addMessage("assistant", data.assistantMessage.message, data.assistantMessage.created_at); }
    if (data.escalation?.reference_code) notice.textContent = "A high-priority Human Helpdesk request was saved: " + data.escalation.reference_code + ".";
    input.value = "";
  } catch (error: any) { notice.textContent = error.message || "Message could not be sent. Please retry."; }
  finally { typing.classList.add("hidden"); sendButton.disabled = false; input.disabled = expired; if (!expired) input.focus(); }
});
byId<HTMLButtonElement>("request-human").addEventListener("click", requestHuman);
byId<HTMLButtonElement>("request-human-ended").addEventListener("click", requestHuman);
(async () => { try { await loadSession(); } catch (error: any) { notice.textContent = error.message || "Dost AI is temporarily unavailable."; startButton.disabled = true; } })();
