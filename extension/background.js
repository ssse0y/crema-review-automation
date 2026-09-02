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

async function downloadText(filename, value) {
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(value)}`;
  return chrome.downloads.download({url, filename, conflictAction: "overwrite", saveAs: false});
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
      const {captureFolder} = await settings();
      const date = new Date().toLocaleDateString("sv-SE");
      const suffix = message.index ? `_${String(message.index).padStart(2, "0")}` : `_${message.label || "진단"}`;
      const filename = `${captureFolder ? captureFolder + "/" : ""}${date}${suffix}.png`;
      const downloadId = await chrome.downloads.download({url: dataUrl, filename, conflictAction: "uniquify", saveAs: false});
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
      const {captureFolder} = await settings();
      const date = new Date().toLocaleDateString("sv-SE");
      const filename = `${captureFolder ? captureFolder + "/" : ""}${date}_부정리뷰.json`;
      await downloadText(filename, JSON.stringify(message.rows || [], null, 2));
      sendResponse({ok: true, filename});
      return;
    }
  })().catch(async error => {
    const prior = await chrome.storage.local.get({automationLog: []});
    await chrome.storage.local.set({automationLog: [...prior.automationLog.slice(-199), `[${new Date().toLocaleString("ko-KR")}] 백그라운드 오류: ${error}`]});
    sendResponse({ok: false, error: String(error)});
  });
  return true;
});
