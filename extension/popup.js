const button = document.getElementById("run");
const status = document.getElementById("status");
const folder = document.getElementById("folder");

chrome.storage.local.get({captureFolder: "부정리뷰"}).then(data => {
  folder.value = data.captureFolder;
});

folder.addEventListener("change", async () => {
  await chrome.storage.local.set({captureFolder: folder.value.trim() || "부정리뷰"});
  status.textContent = "저장 폴더 설정을 저장했습니다.";
});

button.addEventListener("click", async () => {
  await chrome.storage.local.set({captureFolder: folder.value.trim() || "부정리뷰"});
  button.disabled = true;
  status.textContent = "관리자 화면을 여는 중입니다…";
  const result = await chrome.runtime.sendMessage({type: "runNow"});
  status.textContent = result?.ok ? "실행을 시작했습니다." : "실행하지 못했습니다.";
  setTimeout(() => window.close(), 900);
});
