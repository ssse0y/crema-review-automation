const BRIDGE = "http://127.0.0.1:18765";

async function bridge(path, body) {
  const response = await fetch(BRIDGE + path, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`로컬 저장 실패: ${response.status}`);
  return response.json();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "runNow") {
      await chrome.storage.local.set({cremaAutomationRunning: true, liveEnabled: false});
      const stamp = Date.now();
      await chrome.tabs.create({url: `https://admin.cre.ma/v2/review/caution_reviews?crema_auto=1&run=${stamp}`});
      sendResponse({ok: true});
      return;
    }
    if (message.type === "capture") {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: "png"});
      sendResponse(await bridge("/capture", {dataUrl, index: message.index, label: message.label || ""}));
      return;
    }
    if (message.type === "log") {
      sendResponse(await bridge("/log", {message: message.message}));
      return;
    }
    if (message.type === "reviews") {
      sendResponse(await bridge("/reviews", {rows: message.rows}));
      return;
    }
  })().catch(async error => {
    try { await bridge("/log", {message: `확장 프로그램 백그라운드 오류: ${error}`}); } catch (_) {}
    sendResponse({ok: false, error: String(error)});
  });
  return true;
});
