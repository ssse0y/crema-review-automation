# Crema Review Automation

Chrome 확장 프로그램과 로컬 저장 브리지를 이용해 크리마 관리자 리뷰 업무를 자동화하는 프로젝트입니다.

## 주요 기능

- 기존 Chrome의 크리마 로그인 세션 사용
- 크리마 리뷰 관리자 페이지 직접 진입
- `신규 리뷰 관리` 및 `적립금 지급 필요` 탭 자동 탐색
- 상태가 `부정 리뷰`이고 별점이 2점이며 강한 불만 표현이 포함된 리뷰 탐지
- 부정 리뷰 화면을 날짜 기반 PNG 파일로 저장
- 탐지 결과를 JSON으로 로컬 저장
- 확장 프로그램 팝업에서 수동 점검 실행
- 오류나 로그인 만료 시 적립금 지급을 수행하지 않는 fail-closed 동작

## 현재 상태

이 저장소는 포트폴리오용 프로토타입입니다. 리뷰 탐색과 로컬 기록까지 구현되어 있습니다.

다음 기능은 실제 운영 화면 검증 후 활성화하도록 의도적으로 잠겨 있습니다.

- 전체 선택 후 실제 적립금 지급
- Google Sheets 자동 기록

금전성 혜택을 지급하는 작업이므로 DOM 변경, 중복 실행, 기록 실패가 발생하면 지급하지 않는 것을 기본 원칙으로 삼았습니다.

## 구성

```text
extension/          Chrome Manifest V3 확장 프로그램
local_bridge.py     캡처와 JSON을 지정 폴더에 저장하는 로컬 HTTP 브리지
config.example.json 설정 예시
```

## 설치

1. Python 3.10 이상을 설치합니다.
2. 캡처 폴더를 환경 변수로 지정하고 브리지를 실행합니다.

```powershell
$env:CREMA_CAPTURE_DIR = "$HOME\Downloads\crema-negative-reviews"
python .\local_bridge.py
```

3. Chrome에서 `chrome://extensions/`를 엽니다.
4. 개발자 모드를 켭니다.
5. `압축해제된 확장 프로그램을 로드합니다`를 눌러 `extension` 폴더를 선택합니다.
6. 확장 프로그램 아이콘의 `지금 점검 실행` 버튼을 누릅니다.

## 보안 및 운영 주의사항

- 비밀번호, 쿠키, Chrome 프로필, Google Sheet ID를 저장소에 포함하지 않습니다.
- 실제 지급 기능을 활성화하기 전에 테스트 계정이나 소수 리뷰로 검증해야 합니다.
- 같은 계정을 여러 PC에서 동시에 실행하면 중복 처리 위험이 있습니다.
- 관리자 화면 구조가 변경되면 자동화는 지급하지 않고 중단되어야 합니다.

## 기술 스택

- Chrome Extension Manifest V3
- JavaScript
- Python 표준 라이브러리 `http.server`
- Windows Task Scheduler(운영 환경 선택 사항)

## License

MIT
