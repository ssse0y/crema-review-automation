const button = document.getElementById("run");
const status = document.getElementById("status");

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "관리자 화면을 여는 중입니다…";
  const result = await chrome.runtime.sendMessage({type: "runNow"});
  status.textContent = result?.ok ? "실행을 시작했습니다." : "실행하지 못했습니다.";
  setTimeout(() => window.close(), 900);
});
