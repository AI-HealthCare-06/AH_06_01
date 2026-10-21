# 규칙별 테스트 결과표

- 실행: `python3 scripts/report_tests.py` (pytest, 결과 reports/junit.xml)
- 총 210 통과 / 0 실패
- v0.2.0 (M1 step 기반). mmHg 경계값·측정일·결측 비율 테스트는 M1 역할로 넘어가 여기 없다.
- M1 대기 상태(HTN_STAGE2_SCREEN, ISH, WHITE_COAT, MASKED, MORNING, RESISTANT_SUSPECT)는 지금 결정 가능한 부분과 not_evaluable 고정만 검증한다.

| 규칙 | step 값별(4단계) | 결측(필수 제거) | 복약 상태(①②③) | 골든 회귀 | 계약 검증·변환 | 출력 표현 | 합계 |
|---|---|---|---|---|---|---|---|
| ELEVATED | 4 통과 | 3 통과 | 3 통과 | 2 통과 | · | · | 12 통과 |
| PREHTN | 6 통과 | 8 통과 | 3 통과 | 2 통과 | · | · | 19 통과 |
| HTN_SUSPECT | 5 통과 | 9 통과 | 3 통과 | 2 통과 | · | · | 19 통과 |
| HTN_STAGE2_SCREEN | 5 통과 | 5 통과 | 3 통과 | 2 통과 | · | · | 15 통과 |
| ISH | 5 통과 | 4 통과 | 3 통과 | 2 통과 | · | · | 14 통과 |
| WHITE_COAT | 5 통과 | 4 통과 | 3 통과 | 2 통과 | · | · | 14 통과 |
| MASKED | 5 통과 | 5 통과 | 3 통과 | 2 통과 | · | · | 15 통과 |
| MORNING | 5 통과 | 6 통과 | 3 통과 | 2 통과 | · | · | 16 통과 |
| NOCTURNAL_SCREEN | 12 통과 | 6 통과 | 3 통과 | 2 통과 | · | · | 23 통과 |
| RESISTANT_SUSPECT | 6 통과 | 8 통과 | 3 통과 | 2 통과 | · | · | 19 통과 |
| 공통 | · | 2 통과 | 3 통과 | 1 통과 | 13 통과 | 25 통과 | 44 통과 |

## 실패 목록

없음

## pytest 요약

```
210 passed in 0.53s
```
