function safeFolder(value) {
  return String(value || "")
    .replace(/[\\:*?"<>|]/g, "_")
    .replace(/^\/+|\/+$/g, "")
    .trim();
}

function safeFilenamePart(value) {
  return String(value || "").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 60);
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

function captureDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("crema-captures", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("captures", {keyPath: "id", autoIncrement: true});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function captureStore(mode, value) {
  const db = await captureDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("captures", "readwrite");
    const store = transaction.objectStore("captures");
    const request = mode === "add" ? store.add(value) : mode === "all" ? store.getAll() : store.clear();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function resetRunCaptures() {
  await captureStore("clear");
}

async function downloadStagedCaptures() {
  const captures = await captureStore("all");
  if (!captures.length) return 0;
  for (const capture of captures) {
    await chrome.downloads.download({
      url: capture.dataUrl,
      filename: capture.filename,
      conflictAction: "uniquify",
      saveAs: false
    });
  }
  await captureStore("clear");
  return captures.length;
}

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (!notificationId.startsWith("crema-") || buttonIndex !== 0) return;
  try {
    const count = await downloadStagedCaptures();
    await chrome.notifications.clear(notificationId);
    await chrome.notifications.create(`crema-download-${Date.now()}`, {
      type: "basic",
      iconUrl: "icon.png",
      title: "부정리뷰 캡처 다운로드",
      message: count ? `${count}개의 캡처본 다운로드를 시작했습니다.` : "다운로드할 캡처본이 없습니다."
    });
  } catch (error) {
    await chrome.notifications.create(`crema-download-error-${Date.now()}`, {
      type: "basic",
      iconUrl: "icon.png",
      title: "캡처본 다운로드 오류",
      message: String(error)
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "runNow") {
      await resetRunCaptures();
      await chrome.storage.local.set({
        cremaAutomationRunning: true,
        cremaAutomationPhase: "review",
        liveEnabled: false,
        lastRunStatus: "running",
        lastRunMessage: "부정 리뷰를 확인하고 있습니다.",
        lastRunDetail: "",
        lastRunAt: new Date().toISOString(),
        paymentCompletionNotified: false
      });
      const stamp = Date.now();
      await chrome.tabs.create({url: `https://admin.cre.ma/v2/review/new_reviews?tab=mileage_required&crema_auto=1&run=${stamp}`});
      sendResponse({ok: true});
      return;
    }
    if (message.type === "runCaptureTest") {
      await resetRunCaptures();
      await chrome.storage.local.set({
        cremaAutomationRunning: true,
        cremaAutomationPhase: "capture_test",
        lastRunStatus: "running",
        lastRunMessage: "첫 번째 리뷰의 캡처·시트 기록과 다운로드 알림을 테스트하고 있습니다.",
        lastRunDetail: "",
        lastRunAt: new Date().toISOString(),
        paymentCompletionNotified: false
      });
      const stamp = Date.now();
      await chrome.tabs.create({url: `https://admin.cre.ma/v2/review/new_reviews?tab=mileage_required&crema_auto=1&run=${stamp}`});
      sendResponse({ok: true});
      return;
    }
    if (message.type === "runSheetTest") {
      await resetRunCaptures();
      await chrome.storage.local.set({
        cremaAutomationRunning: true,
        cremaAutomationPhase: "sheet_test",
        lastRunStatus: "running",
        lastRunMessage: "첫 번째 리뷰를 스프레드시트에 기록하고 있습니다.",
        lastRunDetail: "",
        lastRunAt: new Date().toISOString(),
        paymentCompletionNotified: false
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
      if (message.status === "success" || message.status === "error") {
        const notificationState = await chrome.storage.local.get({paymentCompletionNotified: false});
        if (message.status === "success" && notificationState.paymentCompletionNotified) {
          sendResponse({ok: true, notificationAlreadySent: true});
          return;
        }
        const notificationId = `crema-${Date.now()}`;
        const stagedCaptures = await captureStore("all");
        const canDownload = stagedCaptures.length > 0;
        await chrome.notifications.create(notificationId, {
          type: "basic",
          iconUrl: "icon.png",
          title: message.status === "success" ? "크리마 작업 완료" : "크리마 작업 오류",
          message: `${message.message || (message.status === "success" ? "작업이 완료되었습니다." : "작업 중 오류가 발생했습니다.")}${canDownload ? "\n아래 버튼을 눌러 캡처본을 내려받으세요." : ""}`,
          buttons: canDownload ? [{title: "캡처본 다운받기"}] : [],
          priority: message.status === "error" ? 2 : 1
        });
      }
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
      await captureStore("add", {dataUrl, filename});
      sendResponse({ok: true, filename, savedPath: `임시 보관: ${filename}`});
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
      const clickResult = results[0]?.result || {ok: false, error: "최종 지급 버튼 실행 결과를 받지 못했습니다."};
      if (clickResult.ok) {
        const notificationId = `crema-payment-${Date.now()}`;
        const stagedCaptures = await captureStore("all");
        const canDownload = stagedCaptures.length > 0;
        await chrome.storage.local.set({
          paymentCompletionNotified: true,
          lastRunStatus: "success",
          lastRunMessage: "적립금 지급 버튼 클릭이 완료되었습니다.",
          lastRunDetail: "크리마에서 적립금 지급 처리를 시작했습니다.",
          lastRunAt: new Date().toISOString()
        });
        await chrome.notifications.create(notificationId, {
          type: "basic",
          iconUrl: "icon.png",
          title: "크리마 적립금 지급 완료",
          message: `적립금 지급 처리를 시작했습니다.${canDownload ? "\n아래 버튼을 눌러 캡처본을 내려받으세요." : ""}`,
          buttons: canDownload ? [{title: "캡처본 다운받기"}] : [],
          priority: 1
        });
      }
      sendResponse(clickResult);
      return;
    }
    if (message.type === "saveCapture") {
      const {captureFolder} = await settings();
      const date = new Date().toLocaleDateString("sv-SE");
      const reviewId = safeFilenamePart(message.reviewId);
      const identity = reviewId ? `${reviewId}_` : "";
      const filename = `${captureFolder ? captureFolder + "/" : ""}${date}_${identity}${String(message.index).padStart(2, "0")}_${message.part}${message.page > 1 ? `_${String(message.page).padStart(2, "0")}` : ""}.png`;
      await captureStore("add", {dataUrl: message.dataUrl, filename});
      sendResponse({ok: true, filename, savedPath: `임시 보관: ${filename}`});
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
