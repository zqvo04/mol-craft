# mol-craft

설치·로그인·서버 없이 브라우저에서 도는 분자 조립 + UFF 역장 분석 도구.

## 실행

```bash
python3 -m http.server 8000   # 또는 아무 정적 서버
# http://localhost:8000
```

빌드 단계도 npm 의존성도 없다. `index.html`을 그대로 서빙하면 된다.

## 테스트

```bash
node --test
```

`test/validation.test.js`가 문헌값(정사면체 109.47°, 에탄 회전장벽, 의자<보트)을 검증한다.
이 테스트가 깨지면 물리 결과를 신뢰하지 말 것.

## 물리 모델과 한계

- **역장:** UFF (Rappé et al., *JACS* **1992**, 114, 10024). 결합 신축 · 결합각 · 비틀림 · 반데르발스 4개 항.
- **포함하지 않는 것:** 정전기(부분전하) 항, 용매 효과, 전자 상관, 여기 상태. 전부 진공 기준.
- **신뢰 구간:** 2주기 유기 분자의 배좌 비교와 상대 에너지 경향은 정성적으로 유효하다.
  초원자가(PCl₅ 등)와 전이금속은 UFF가 축/적도 위치를 구분하지 못하므로 **정량 해석 불가**.
- **양자계산 대체가 아니다.** 반응 에너지, pKa, 전이상태에는 사용할 수 없다.

## 배포

GitHub Pages. **빌드 단계 없음** — 저장소 루트를 그대로 서빙한다.

1. GitHub → Settings → Pages
2. Source: `Deploy from a branch`
3. Branch: `main`, 폴더 `/ (root)` → Save
4. 1~2분 뒤 `https://<owner>.github.io/mol-craft/` 에서 열린다

CI(`.github/workflows/test.yml`)는 push/PR마다 `node --test`를 돌린다.
물리 검증 스위트가 빨간불이면 배포된 수치를 믿지 말 것.

## 저장과 공유

- **자동 저장:** `localStorage`(키 `molcraft:last`). 새로고침해도 마지막 구조가 복원된다.
- **링크 공유:** URL 해시(`#s=...`)에 구조를 담는다. 서버를 거치지 않으므로 영구히 유효하다.
  진입 시 우선순위는 URL 해시 > localStorage > 기본 프리셋이다.
