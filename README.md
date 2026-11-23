# 반걸음 (HalfStep)

큰 목표를 바로 실행할 수 있는 작은 단계로 쪼개 주는 앱. 목표·설계·현재 상태는 `claude/반걸음(HalfStep) 제품·설계 문서.md` 참고.

## 시작하기
Node.js 22 이상이 필요합니다.

```
npm install
npm run dev      # 개발 서버 (http://localhost:5173)
npm test         # 테스트
npm run build    # 타입 검사 + 빌드
```

## 배포 (인터넷 주소에 올리기)

반걸음은 서버가 필요 없는 정적 사이트라, `npm run build`로 만든 `dist` 폴더만 HTTPS 주소에 올리면 돼요.

### GitHub Pages (자동 배포 포함)
1. GitHub에 저장소를 만들고 이 폴더를 올려요(`main` 브랜치).
2. 저장소 Settings → Pages → Build and deployment → Source를 **GitHub Actions**로 바꿔요.
3. 이후 `main`에 올릴 때마다 `.github/workflows/deploy.yml`이 테스트 → 빌드 → 배포를 해요. Actions 탭에서 진행 상황을 볼 수 있어요.
4. 주소는 `https://사용자이름.github.io/저장소이름/` 이에요.

주의: GitHub Pages는 무료 계정에서는 **공개 저장소**에서만 쓸 수 있어요. 비공개로 두려면 유료 플랜이 필요하거나, 아래 Cloudflare Pages를 쓰세요.

### Cloudflare Pages (비공개 저장소도 가능)
Cloudflare 대시보드 → Workers & Pages → Pages에서 GitHub 저장소를 연결하고, 빌드 명령 `npm run build`, 출력 폴더 `dist`로 설정하면 돼요. 주소 맨 앞(`/`)에 올라가므로 BASE_PATH는 필요 없어요.

### 다른 하위 주소에 올릴 때
`BASE_PATH=/하위경로/ npm run build` 처럼 빌드하면 돼요(끝에 `/` 포함).

## 휴대폰에 설치 (PWA)
배포한 주소를 휴대폰 Chrome에서 열고 메뉴 → "홈 화면에 추가"(또는 "앱 설치")를 누르면 앱처럼 설치돼요. 설치 후에는 인터넷 없이도 열리고, 저장 공간도 보통 자동으로 보호돼요.

## 백업
설정 → "백업과 저장 공간"에서 백업 파일로 저장하거나(휴대폰에서는 "공유하기"로 드라이브 등에 보내기), 다른 기기·나중의 Android 앱에서 가져올 수 있어요. 이미 있는 목표는 건너뛰어서 겹치지 않아요.
같은 와이파이의 휴대폰에서 잠깐 확인할 때는 `npm run build && npx vite preview --host`로 나오는 주소로 접속하면 돼요(이 경우 HTTPS가 아니라 설치·오프라인은 동작하지 않아요).

## AI
- PC의 Chrome: "AI 설정"에서 Chrome 내장 AI 상태를 확인하고, 필요하면 "모델 받기"를 누르세요. 쓸 수 있는지는 Chrome 버전과 PC 사양에 따라 달라요.
- 휴대폰 웹 버전: 기본 규칙으로 동작해요. Android 앱에서 기기 내 AI를 쓸 수 있게 될 예정이에요.
