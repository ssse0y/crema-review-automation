function safeFolder(value) {
  return String(value || "")
    .replace(/[\\:*?"<>|]/g, "_")
    .replace(/^\/+|\/+$/g, "")
    .trim();
}

async function settings() {
  const data = await chrome.storage.local.get({captureFolder: ""});
  return {captureFolder: safeFolder(data.captureFolder)};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "runNow") {
      await chrome.storage.local.set({
        cremaAutomationRunning: true,
        liveEnabled: false,
        lastRunStatus: "running",
        lastRunMessage: "적립금 지급 작업을 실행하고 있습니다.",
        lastRunDetail: "",
        lastRunAt: new Date().toISOString()
      });
      const stamp = Date.now();
      await chrome.tabs.create({url: `https://admin.cre.ma/v2/review/caution_reviews?crema_auto=1&run=${stamp}`});
      sendResponse({ok: true});
      return;
    }
    if (message.type === "runStatus") {
      await chrome.storage.local.set({
        lastRunStatus: message.status,
        lastRunMessage: message.message || "",
        lastRunDetail: message.detail || "",
        lastRunAt: new Date().toISOString()
      });
      sendResponse({ok: true});
      return;
    }
    if (message.type === "capture") {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: "png"});
      const {captureFolder} = await settings();
      const date = new Date().toLocaleDateString("sv-SE");
      const suffix = message.index ? `_${String(message.index).padStart(2, "0")}` : `_${message.label || "진단"}`;
      const filename = `${captureFolder ? captureFolder + "/" : ""}${date}${suffix}.png`;
      const downloadId = await chrome.downloads.download({url: dataUrl, filename, conflictAction: "uniquify", saveAs: false});
      sendResponse({ok: true, downloadId, filename});
      return;
    }
    if (message.type === "captureRaw") {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: "png"});
      sendResponse({ok: true, dataUrl});
      return;
    }
    if (message.type === "saveCapture") {
      const {captureFolder} = await settings();
      const date = new Date().toLocaleDateString("sv-SE");
      const filename = `${captureFolder ? captureFolder + "/" : ""}${date}_${String(message.index).padStart(2, "0")}_${message.part}${message.page > 1 ? `_${String(message.page).padStart(2, "0")}` : ""}.png`;
      const downloadId = await chrome.downloads.download({url: message.dataUrl, filename, conflictAction: "uniquify", saveAs: false});
      sendResponse({ok: true, downloadId, filename});
      return;
    }
    if (message.type === "log") {
      const prior = await chrome.storage.local.get({automationLog: []});
      const entry = `[${new Date().toLocaleString("ko-KR")}] ${message.message}`;
      await chrome.storage.local.set({automationLog: [...prior.automationLog.slice(-199), entry]});
      sendResponse({ok: true});
      return;
    }
    if (message.type === "reviews") {
      await chrome.storage.local.set({
        pendingReviewRows: message.rows || [],
        pendingReviewSavedAt: new Date().toISOString()
      });
      sendResponse({ok: true, stored: "pendingReviewRows"});
      return;
    }
  })().catch(async error => {
    const prior = await chrome.storage.local.get({automationLog: []});
    await chrome.storage.local.set({
      automationLog: [...prior.automationLog.slice(-199), `[${new Date().toLocaleString("ko-KR")}] 백그라운드 오류: ${error}`],
      lastRunStatus: "error",
      lastRunMessage: "캡처본 저장 중 오류가 발생했습니다.",
      lastRunDetail: String(error),
      lastRunAt: new Date().toISOString()
    });
    sendResponse({ok: false, error: String(error)});
  });
  return true;
});
