const button = document.getElementById("run");
const captureTest = document.getElementById("captureTest");
const sheetTest = document.getElementById("sheetTest");
const status = document.getElementById("status");
const folder = document.getElementById("folder");
const editArea = document.getElementById("editArea");
const savedArea = document.getElementById("savedArea");
const savedPath = document.getElementById("savedPath");
const save = document.getElementById("save");
const edit = document.getElementById("edit");
const openDownloads = document.getElementById("openDownloads");
const sheetEditArea = document.getElementById("sheetEditArea");
const sheetSavedArea = document.getElementById("sheetSavedArea");
const sheetUrl = document.getElementById("sheetUrl");
const savedSheetUrl = document.getElementById("savedSheetUrl");
const saveSheet = document.getElementById("saveSheet");
const editSheet = document.getElementById("editSheet");
const sheetTabName = document.getElementById("sheetTabName");
const runResult = document.getElementById("runResult");
const errorDetails = document.getElementById("errorDetails");
const errorText = document.getElementById("errorText");
const webAppUrl = document.getElementById("webAppUrl");
const sheetApiKey = document.getElementById("sheetApiKey");
const saveWebAppUrl = document.getElementById("saveWebAppUrl");
const saveApiKey = document.getElementById("saveApiKey");
const authState = document.getElementById("authState");

function renderRunStatus(data) {
  const state = data.lastRunStatus || "";
  runResult.className = state;
  runResult.textContent = data.lastRunMessage || "";
  if (state === "error" && data.lastRunDetail) {
    errorText.textContent = data.lastRunDetail;
    errorDetails.classList.remove("hidden");
  } else {
    errorDetails.classList.add("hidden");
    errorDetails.open = false;
    errorText.textContent = "";
  }
}

chrome.storage.local.get({lastRunStatus: "", lastRunMessage: "", lastRunDetail: ""}).then(renderRunStatus);

chrome.storage.local.get({sheetWebAppUrl: "", sheetApiKey: ""}).then(data => {
  webAppUrl.value = data.sheetWebAppUrl;
  sheetApiKey.value = data.sheetApiKey;
  authState.textContent = data.sheetWebAppUrl && data.sheetApiKey ? "권한 연결 정보가 저장되어 있습니다." : "배포 URL과 연결 키를 입력해주세요.";
});

saveWebAppUrl.addEventListener("click", async () => {
  const url = webAppUrl.value.trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(url)) {
    authState.textContent = "배포 URL을 확인해주세요. 주소 끝은 /exec여야 합니다.";
    return;
  }
  await chrome.storage.local.set({sheetWebAppUrl: url});
  authState.textContent = "Apps Script 배포 URL을 저장했습니다.";
});

saveApiKey.addEventListener("click", async () => {
  const key = sheetApiKey.value.trim();
  if (!key) {
    authState.textContent = "연결 키를 입력해주세요.";
    return;
  }
  await chrome.storage.local.set({sheetApiKey: key});
  authState.textContent = "연결 키를 저장했습니다.";
});

function showSaved(value) {
  folder.value = value;
  savedPath.textContent = value
    ? `Chrome 기본 다운로드 폴더\\${value.replaceAll("/", "\\")}`
    : "Chrome 기본 다운로드 폴더";
  editArea.classList.add("hidden");
  savedArea.classList.remove("hidden");
}

chrome.storage.local.get({captureFolder: "", captureFolderSaved: true}).then(data => {
  folder.value = data.captureFolder;
  if (data.captureFolderSaved) showSaved(data.captureFolder);
});

save.addEventListener("click", async () => {
  const value = folder.value.trim();
  await chrome.storage.local.set({captureFolder: value, captureFolderSaved: true});
  showSaved(value);
  status.textContent = "저장 경로를 저장했습니다.";
});

edit.addEventListener("click", () => {
  savedArea.classList.add("hidden");
  editArea.classList.remove("hidden");
  folder.focus();
});

openDownloads.addEventListener("click", async () => {
  await chrome.tabs.create({url: "chrome://settings/downloads"});
  window.close();
});

function showSavedSheet(value, tabName) {
  sheetUrl.value = value;
  sheetTabName.value = tabName || "";
  savedSheetUrl.href = value;
  savedSheetUrl.title = value;
  sheetEditArea.classList.add("hidden");
  sheetSavedArea.classList.remove("hidden");
}

chrome.storage.local.get({reviewSheetUrl: "", reviewSheetUrlSaved: false, targetSheetName: ""}).then(data => {
  sheetUrl.value = data.reviewSheetUrl;
  sheetTabName.value = data.targetSheetName;
  if (data.reviewSheetUrlSaved && data.reviewSheetUrl) showSavedSheet(data.reviewSheetUrl, data.targetSheetName);
});

saveSheet.addEventListener("click", async () => {
  const value = sheetUrl.value.trim();
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(value)) {
    status.textContent = "Google 스프레드시트 주소를 확인해주세요.";
    return;
  }
  await chrome.storage.local.set({
    reviewSheetUrl: value,
    reviewSheetUrlSaved: true,
    targetSheetName: sheetTabName.value.trim()
  });
  showSavedSheet(value, sheetTabName.value.trim());
  status.textContent = "부정리뷰 기록 링크를 저장했습니다.";
});

editSheet.addEventListener("click", () => {
  sheetSavedArea.classList.add("hidden");
  sheetEditArea.classList.remove("hidden");
  sheetUrl.focus();
});

savedSheetUrl.addEventListener("click", async event => {
  event.preventDefault();
  if (savedSheetUrl.href) await chrome.tabs.create({url: savedSheetUrl.href});
});

captureTest.addEventListener("click", async () => {
  await chrome.storage.local.set({captureFolder: folder.value.trim()});
  captureTest.disabled = true;
  status.textContent = "첫 번째 리뷰의 캡처·저장·시트 기록 테스트를 시작합니다…";
  const result = await chrome.runtime.sendMessage({type: "runCaptureTest"});
  if (!result?.ok) {
    renderRunStatus({lastRunStatus: "error", lastRunMessage: "캡처·시트 기록 테스트를 시작하지 못했습니다.", lastRunDetail: result?.error || "알 수 없는 오류"});
    return;
  }
  setTimeout(() => window.close(), 700);
});

sheetTest.addEventListener("click", async () => {
  sheetTest.disabled = true;
  status.textContent = "첫 번째 리뷰의 실제 내용을 기록하고 있습니다…";
  const result = await chrome.runtime.sendMessage({type: "runSheetTest"});
  if (result?.ok) {
    setTimeout(() => window.close(), 700);
  } else {
    renderRunStatus({lastRunStatus: "error", lastRunMessage: "스프레드시트 입력 테스트에 실패했습니다.", lastRunDetail: result?.error || "알 수 없는 오류"});
    status.textContent = "";
  }
  sheetTest.disabled = false;
});

button.addEventListener("click", async () => {
  await chrome.storage.local.set({captureFolder: folder.value.trim()});
  button.disabled = true;
  status.textContent = "관리자 화면을 여는 중입니다…";
  const result = await chrome.runtime.sendMessage({type: "runNow"});
  status.textContent = result?.ok ? "실행을 시작했습니다." : "실행하지 못했습니다.";
  renderRunStatus(result?.ok
    ? {lastRunStatus: "running", lastRunMessage: "부정 리뷰를 확인하고 있습니다.", lastRunDetail: ""}
    : {lastRunStatus: "error", lastRunMessage: "작업을 시작하지 못했습니다.", lastRunDetail: result?.error || "알 수 없는 오류"});
  setTimeout(() => window.close(), 900);
});
