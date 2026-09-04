function safeFolder(value) {
  return String(value || "")
    .replace(/[\\:*?"<>|]/g, "_")
    .replace(/^\/+|\/+$/g, "")
    .trim();
}

let lastCaptureAt = 0;
async function waitForCaptureSlot() {
  const remaining = 650 - (Date.now() - lastCaptureAt);
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  lastCaptureAt = Date.now();
}

async function waitForDownload(downloadId, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const items = await chrome.downloads.search({id: downloadId});
    const item = items[0];
    if (item?.state === "complete") return item;
    if (item?.state === "interrupted") throw new Error(`파일 저장이 중단되었습니다: ${item.error || "원인 미상"}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("파일 저장 완료를 30초 안에 확인하지 못했습니다.");
}

async function settings() {
  const data = await chrome.storage.local.get({captureFolder: ""});
  return {captureFolder: safeFolder(data.captureFolder)};
}

function parseSpreadsheet(url) {
  const id = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] || "";
  const gid = String(url || "").match(/(?:[#?&]gid=)(\d+)/)?.[1];
  return {spreadsheetId: id, sheetId: gid === undefined ? null : Number(gid)};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "runNow") {
      await chrome.storage.local.set({
        cremaAutomationRunning: true,
        cremaAutomationPhase: "review",
        liveEnabled: false,
        lastRunStatus: "running",
        lastRunMessage: "부정 리뷰를 확인하고 있습니다.",
        lastRunDetail: "",
        lastRunAt: new Date().toISOString()
      });
      const stamp = Date.now();
      await chrome.tabs.create({url: `https://admin.cre.ma/v2/review/new_reviews?tab=mileage_required&crema_auto=1&run=${stamp}`});
      sendResponse({ok: true});
      return;
    }
    if (message.type === "runCaptureTest") {
      await chrome.storage.local.set({
        cremaAutomationRunning: true,
        cremaAutomationPhase: "capture_test",
        lastRunStatus: "running",
        lastRunMessage: "첫 번째 리뷰 캡처를 테스트하고 있습니다.",
        lastRunDetail: "",
        lastRunAt: new Date().toISOString()
      });
      const stamp = Date.now();
      await chrome.tabs.create({url: `https://admin.cre.ma/v2/review/new_reviews?tab=mileage_required&crema_auto=1&run=${stamp}`});
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
      await waitForCaptureSlot();
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: "png"});
      const {captureFolder} = await settings();
      const date = new Date().toLocaleDateString("sv-SE");
      const suffix = message.index ? `_${String(message.index).padStart(2, "0")}` : `_${message.label || "진단"}`;
      const filename = `${captureFolder ? captureFolder + "/" : ""}${date}${suffix}.png`;
      const downloadId = await chrome.downloads.download({url: dataUrl, filename, conflictAction: "uniquify", saveAs: false});
      const completed = await waitForDownload(downloadId);
      sendResponse({ok: true, downloadId, filename, savedPath: completed.filename});
      return;
    }
    if (message.type === "captureRaw") {
      await waitForCaptureSlot();
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: "png"});
      sendResponse({ok: true, dataUrl});
      return;
    }
    if (message.type === "mainWorldFinalPay") {
      if (!sender.tab?.id) throw new Error("클릭할 크리마 탭을 찾지 못했습니다.");
      const results = await chrome.scripting.executeScript({
        target: {tabId: sender.tab.id, frameIds: [sender.frameId]},
        world: "MAIN",
        func: marker => {
          const button = document.querySelector(
            `[data-crema-final-pay="${marker}"][class*="AppButton__button--style-blue"]`
          );
          if (!button || button.innerText.replace(/\s+/g, "").trim() !== "적립금지급" || button.disabled) {
            return {ok: false, error: "모달 하단의 활성 파란 적립금 지급 버튼을 찾지 못했습니다."};
          }
          button.click();
          return {ok: true, info: {className: button.className, text: button.innerText}};
        },
        args: [message.marker]
      });
      sendResponse(results[0]?.result || {ok: false, error: "최종 지급 버튼 실행 결과를 받지 못했습니다."});
      return;
    }
    if (message.type === "saveCapture") {
      const {captureFolder} = await settings();
      const date = new Date().toLocaleDateString("sv-SE");
      const filename = `${captureFolder ? captureFolder + "/" : ""}${date}_${String(message.index).padStart(2, "0")}_${message.part}${message.page > 1 ? `_${String(message.page).padStart(2, "0")}` : ""}.png`;
      const downloadId = await chrome.downloads.download({url: message.dataUrl, filename, conflictAction: "uniquify", saveAs: false});
      const completed = await waitForDownload(downloadId);
      sendResponse({ok: true, downloadId, filename, savedPath: completed.filename});
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
    if (message.type === "writeSheet") {
      const config = await chrome.storage.local.get({
        reviewSheetUrl: "",
        targetSheetName: "",
        sheetWebAppUrl: "",
        sheetApiKey: "",
        pendingReviewRows: []
      });
      const rows = message.rows || config.pendingReviewRows || [];
      const target = parseSpreadsheet(config.reviewSheetUrl);
      if (!target.spreadsheetId) throw new Error("부정리뷰 기록 링크가 올바르지 않습니다.");
      if (!config.sheetWebAppUrl || !config.sheetApiKey) throw new Error("Google Sheets 권한 연결이 필요합니다.");
      const response = await fetch(config.sheetWebAppUrl, {
        method: "POST",
        headers: {"Content-Type": "text/plain;charset=utf-8"},
        body: JSON.stringify({
          apiKey: config.sheetApiKey,
          spreadsheetId: target.spreadsheetId,
          sheetId: target.sheetId,
          sheetName: config.targetSheetName || "",
          rows
        }),
        redirect: "follow"
      });
      if (!response.ok) throw new Error(`Google Sheets 연결 오류 (${response.status})`);
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || "Google Sheets 기록 실패");
      await chrome.storage.local.set({pendingReviewRows: [], pendingReviewSavedAt: ""});
      sendResponse({ok: true, ...result});
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
