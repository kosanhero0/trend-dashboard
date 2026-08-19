# 실시간 트렌드 주제 대시보드 (완전 자동, Claude 세션 불필요)

이 저장소를 GitHub에 올리고 아래 설정만 마치면, 이후로는 **Claude 세션이나 토큰 없이** GitHub의 무료 스케줄러(GitHub Actions)가 알아서
- 매시간(평일 09~18시 KST) 실시간 트렌드 주제 10개 + 주제별 키워드 10개씩을 새로 조사하고
- `data.json`을 갱신하고
- 대시보드 페이지(`index.html`)가 그 데이터를 그대로 보여줍니다.

완성되면 `https://<내 GitHub 아이디>.github.io/<저장소 이름>/` 주소로 언제든 최신 대시보드를 볼 수 있습니다.

---

## 처음 한 번만 하는 설정 (5단계, 총 10분 정도)

### 1. GitHub 저장소 만들기
1. [github.com](https://github.com) 에 로그인 (계정이 없다면 무료로 가입)
2. 오른쪽 위 **+** → **New repository**
3. 이름을 원하는 대로 입력 (예: `trend-dashboard`), **Public**으로 설정 (무료 계정은 Public이어야 GitHub Pages를 쓸 수 있습니다)
4. **Create repository**

### 2. 이 파일들 업로드
1. 방금 만든 저장소 페이지에서 **Add file → Upload files** 클릭
2. 이 zip 안의 모든 파일/폴더(`index.html`, `data.json`, `scripts/`, `.github/` 포함)를 그대로 드래그해서 올리기
   - `.github` 폴더처럼 점(`.`)으로 시작하는 폴더도 그대로 올라가야 합니다. 안 보이면 폴더째로 드래그하세요.
3. **Commit changes**

### 3. 네이버 오픈API 키 발급 (무료)
1. [developers.naver.com/apps/#/register](https://developers.naver.com/apps/#/register) 접속 후 로그인
2. 애플리케이션 이름은 아무거나 (예: 트렌드대시보드)
3. **사용 API**에서 다음 두 가지를 체크:
   - 검색 (블로그, 뉴스 등)
   - 데이터랩(검색어트렌드)
4. 서비스 환경은 **웹 서비스 URL**을 선택하고, URL 칸에는 1단계에서 만든 저장소 주소나 `https://github.com` 아무거나 입력해도 됩니다 (실제로 이 URL로 트래픽을 보내지 않으므로 크게 중요하지 않습니다)
5. 등록하면 **Client ID**와 **Client Secret**이 발급됩니다. 이 두 값을 복사해두세요 (Secret은 다시 안 보여줄 수 있으니 꼭 저장).

### 4. GitHub 저장소에 키 등록 (Secrets)
1. 저장소 → **Settings** → 왼쪽 메뉴 **Secrets and variables → Actions**
2. **New repository secret** 클릭
   - Name: `NAVER_CLIENT_ID` / Value: 3단계에서 받은 Client ID → Add secret
3. 다시 **New repository secret**
   - Name: `NAVER_CLIENT_SECRET` / Value: 3단계에서 받은 Client Secret → Add secret

이 키는 GitHub 서버 안에서만 쓰이고 절대 페이지에 노출되지 않습니다.

### 5. GitHub Pages 켜기
1. 저장소 → **Settings** → 왼쪽 메뉴 **Pages**
2. **Build and deployment → Source**: `Deploy from a branch` 선택
3. **Branch**: `main` / `/ (root)` 선택 → **Save**
4. 1~2분 후 상단에 뜨는 주소(`https://<아이디>.github.io/<저장소이름>/`)가 대시보드 주소입니다.

---

## 정상 동작 확인하기

1. 저장소 → **Actions** 탭 → 왼쪽에서 **Update trend dashboard data** 클릭
2. 오른쪽 **Run workflow** 버튼 → **Run workflow** 눌러서 수동으로 한 번 실행
3. 1~2분 후 초록색 체크가 뜨면 성공. 실패(빨간 X)하면 로그를 열어 원인을 확인하세요 (대부분 Secret 이름 오타나 API 키 미승인 문제입니다)
4. 성공했다면 대시보드 주소를 새로고침해서 최신 데이터가 보이는지 확인

이후로는 평일 9시~18시 매시간 자동으로 실행됩니다. 필요하면 **Run workflow**로 언제든 수동 실행도 가능합니다.

---

## Claude가 만든 원본 대시보드와의 차이

이 자동화 버전은 **Claude의 언어 판단 없이** 순수 데이터 규칙으로만 동작합니다. 그래서:

- **주제 선정**: Google 트렌드 실시간(KR) 상위 항목을 그대로 후보로 쓰고, 네이버 데이터랩 전일대비 증가율 순으로 10개를 고릅니다.
- **키워드 확장**: "OO 이유", "OO 근황", "OO 프로필" 같은 정해진 접미사 10개를 기계적으로 붙여 만듭니다. Claude가 뉴스 맥락을 읽고 만든 것만큼 정교하지 않을 수 있습니다.
- **추천 이유 문구**: "검색 지수 X, 전일대비 Y%" 같은 사실 기반 문장으로 자동 생성됩니다. Claude가 썼던 것 같은 맥락 설명(왜 화제인지)은 없습니다.
- **경쟁도**: API 호출을 아끼기 위해 주제당 상위 3개 키워드만 블로그 문서수를 실제 조회하고, 나머지는 그 기준값을 재사용합니다.

더 정교한 분석이 필요할 때는 언제든 Claude 세션에서 "오늘 트렌드 분석해줘"라고 요청하시면 됩니다 — 이 자동화는 "손 안 대도 최신 상태 유지"가 목적이고, 깊이 있는 분석은 Claude가 직접 할 때가 더 좋습니다.

## 커스터마이징

- 주제/키워드 개수: `scripts/generate-data.mjs` 상단의 `TOPIC_COUNT`, `KEYWORDS_PER_TOPIC` 값을 수정
- 갱신 주기: `.github/workflows/update.yml`의 `cron` 값을 수정 ([crontab.guru](https://crontab.guru)에서 UTC 기준으로 계산, KST는 UTC+9)
- 키워드 접미사 목록: `scripts/generate-data.mjs`의 `SUFFIXES` 배열 수정
- 카테고리 분류 규칙: `scripts/generate-data.mjs`의 `CATEGORY_RULES` 정규식 수정
