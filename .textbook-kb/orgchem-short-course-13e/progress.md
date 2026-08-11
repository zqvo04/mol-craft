# progress — Organic Chemistry: A Short Course (13e) 내재화

**출처**: 사용자 제공 개념 요약 md (원서 전문 아님 — 챕터별 핵심 용어 정의 모음 + Claude 추론 프로토콜).
**따라서 이 KB의 성격**: 요약을 그대로 옮기는 게 아니라, 각 개념을 대학 유기화학 수준의
정확한 진술로 복원하고 ▲원문 요약의 부정확·오류를 교정 ▲mol-craft가 표현 가능/불가능한
지점을 표시한다. 이 세 축이 노트의 실제 가치다.

**노트 섹션 규약**
- `## 개념` — 정확한 정의/조건. 수치·각도·pKa는 원문보다 정밀하게.
- `## 규칙·메커니즘` — 왜 성립하는지의 논리 골격(암기 목록 아님).
- `## 왜 이 예제인가` — 예제가 어느 개념 경계를 찌르는지.
- `## ⚠ 원문 교정` — 요약본이 틀렸거나 오해를 부르는 지점. **학습 플랫폼에 그대로 옮기면 안 되는 것들.**
- `## ⚙ mol-craft 접점` — `[가능]` 지금 코드로 표현됨 / `[부분]` 근사·제한 있음 / `[불가]` 현재 모델 밖.
- `## 다음 장으로 넘기는 것`

| Ch | 제목 | 상태 |
|---|---|---|
| 01 | Bonding and Isomerism | done |
| 02 | Alkanes and Cycloalkanes; Conformational/Geometric Isomerism | done |
| 03 | Alkenes and Alkynes | done |
| 04 | Aromatic Compounds | done |
| 05 | Stereoisomerism | done |
| 06 | Organic Halogen Compounds; Substitution and Elimination | done |
| 07 | Alcohols, Phenols, Thiols | done |
| 08 | Ethers and Epoxides | done |
| 09 | Aldehydes and Ketones | done |
| 10 | Carboxylic Acids and Derivatives | done |
| 11 | Amines and Nitrogen Compounds | done |
| 12 | Spectroscopy and Structure Determination | done |
| 13 | Heterocyclic Compounds | done |
| 14 | Synthetic Polymers | done |
| 15 | Lipids and Detergents | done |
| 16 | Carbohydrates | done |
| 17 | Amino Acids, Peptides, Proteins | done |
| 18 | Nucleotides and Nucleic Acids | done |
| — | Claude 추론 프로토콜 (원문 부록) | done → `notes/reasoning-protocol.md` |

**후속 산출물**: `INDEX.md`(라우팅), `concept-map.md`(개념 의존 그래프),
`molcraft-gap.md`(mol-craft 표현력 격차 종합 — 개선 로드맵의 입력).

---

## 검증 로그 (코드를 실제로 실행해 확인한 것)

노트의 `⚙ mol-craft 접점`은 대부분 소스 읽기로 작성했으나, 아래 항목은 **직접 실행해 확인**했다.
추측이 아니라 실측이므로 그대로 신뢰해도 된다.

| 확인 내용 | 결과 |
|---|---|
| `aromatize()` 벤젠 | ✓ `C_R`, 고리 결합차수 1.5 |
| `aromatize()` 피리딘 | **✗ 실패** — `N_2` 유지. `neighbors === 3` 조건에 걸림(N은 이웃 2개) |
| `aromatize()` 피롤 | **✗ 실패** — `N_3` 유지. `hasDoubleBond` 조건에 걸림(N에 이중결합 없음) |
| `aromatize()` 푸란 | **✗ 실패** — `O_3` 유지. 동일 원인 |
| 피롤 N을 강제로 `N_R`+차수 1.5로 승격 | `stability()`가 **`N0 원자가 초과(4/3)` danger 오탐** |
| `slotKinds()` 피리딘 N | `['lonepair']` — 개념과 일치 |
| `slotKinds()` 피롤 N | `['lonepair']` — **개념과 불일치**(π에 들어간 전자쌍을 별도 자리로 표시) |
| `RING_TEMPLATES` 키 | `['benzene', 'cyclohexane']` 2종뿐 |
| `validation.test.js` 부탄 syn 장벽 허용 범위 | 6–14 kcal/mol (문헌 4.5–6.1) — 주석에 "UFF 과대평가" 명시 |

**이 검증으로 초안에서 틀렸던 서술 3건을 수정**: Ch13(헤테로방향족 인식된다 → 안 된다),
Ch18(핵염기 방향족 승격된다 → 안 된다), Ch04(사이클로뷰타다이엔 오인 위험 → 실제 오인 대상은 [6]라디알렌형).

**미검증(추후 확인 필요)**: 암모니아 우산 반전 장벽이 UFF에서 문헌값(~6 kcal/mol)에 가까운지(Ch11),
퓨린 융합 고리에서 `findRings()`가 올바른 2고리를 반환하는지(Ch18).
