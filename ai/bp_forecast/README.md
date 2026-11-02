# 혈압 이력 예측 연구

과거 측정값으로 미래 창을 예측하는 설계 검증용 코드다. 같은 방문의 혈압 단계를 생활습관으로 추정하는 `m1_stage` 및 상태 규칙 `m2_state`와 독립적이다. 운영 API·대시보드에 연결하지 않았고, v9·M1 확률·합성 데이터 학습 모델을 사용하지 않는다.

[전체 설계](../../docs/BP_HISTORY_PREDICTION_DESIGN.md)에 역할, 목표, 이벤트·시간 계약, 자료 수집, 후보 모델, 검증, 성별·연령별 평가, API·화면 연동 조건을 정리했다.

후속 [측정 이력 수집 구현](../../docs/BP_MEASUREMENT_COLLECTION.md)은 설문 선택 정보와 불변 서버 개정을 추가한다. `rexrun_journal.py`는 승인된 전체 서버 개정 내보내기를 연구 입력으로 변환하며, `verify_collection.py`는 합성 브라우저 입력→SQL→연구 모듈 연결을 검증한다. 운영 예측이나 실제 환자 학습 자료 수집을 자동 활성화하지 않는다.

## 재현

저장소 루트에서 Python 3.11 이상으로 실행한다. 핵심 코드와 테스트는 표준 라이브러리만 사용한다.

```powershell
python -m unittest discover -s ai/bp_forecast/tests -v
python -m ai.bp_forecast.run_demo --out .cache/bp-forecast-design
```

현재 시스템에 `jsonschema`가 있으면 다음 계약 검사도 실행할 수 있다. 이 도구는 핵심 추론 의존성이 아니다.

```powershell
python -m ai.bp_forecast.verify_evidence --input .cache/bp-forecast-design/results.json
```

검토한 집계 근거와 정적 연구 그림을 다시 만들 때는 다음을 실행한다. `requirements-dev.txt`는 선택 도구의 고정 버전 목록이며 앱 의존성을 바꾸지 않는다.

```powershell
python -m ai.bp_forecast.run_demo --out .cache/bp-forecast-design --save-aggregates ai/bp_forecast/evidence
python -m ai.bp_forecast.render_evidence --input .cache/bp-forecast-design/results.json --out ai/bp_forecast/evidence/baseline-mae.png
python -m ai.bp_forecast.verify_evidence --input .cache/bp-forecast-design/results.json
```

`results.json`은 집계 결과·보류 시나리오·연구 추정값이다. 기점별 입력/출력은 무시되는 `.cache`의 `weekly-origin-evidence.private.json`에만 남긴다. 실제 환자 자료를 넣는 수집·CLI 기능은 이번 변경에 없다.

## 구현 경계

| 파일                                       | 구현한 내용                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `history.py`                               | 시간대·단위·개정·중복 검증, 관측/수신 시각을 모두 적용한 과거 복원, 세션·슬롯·일 집계, 기록량·품질 보류 |
| `policy.py`                                | 연구 보조 사건·지원 범위·기록량과 집계 정책의 버전                                                      |
| `forecast.py`                              | 최근 일평균, 7일 평균·중앙값, 28일 평균, 날짜 가중 EWMA, 감쇠 추세 대조군                               |
| `backtest.py`                              | 정답 창 성숙·수신 지연·동결, 보류·정답 누락 분모, 미래 가정혈압 사건 지표, 환자·라벨 시각 purge         |
| `demo.py`                                  | 기존 합성 90일 시연 자료만 읽는 명시적 어댑터                                                           |
| `run_demo.py`                              | 주간 8개·일간 56개 기점, 13개 시험 시나리오 재현                                                        |
| `forecast.schema.json`, `api.openapi.json` | 실행 응답 계약과 배포되지 않은 제안 API                                                                 |
| `evidence/`                                | 개인별 행이 없는 합성 집계 검증 기록과 소스 해시                                                        |

최근 28일 입력과 이후 7일 결과를 분리한다. 알려진 미래 행·사후 정정·다른 사람의 값은 과거 입력에 들어가지 않는다. 과거 표준편차를 예측 범위로 포장하지 않는다. 예측 범위와 진단은 null, `production_eligible`은 항상 false다.

보류 조건의 14일·최근 5일·양 슬롯 3일·최근 2일 등은 **시험할 공학 가설**이다. 임상 지침이 허용한 예측 조건이 아니다. 기기·복약·지원 범위 문제로 보류하더라도 원래 기록을 지우거나 낮춰 계산하지 않는다.

## 실측 서비스로 넘어가기 위한 조건

측정별 불변 원본·수신/수정 이력, 실제 개인별 입력과 미래 라벨, 학습/보정/잠금 환자 분리, 하위군 성능, 예측 범위 보정과 외부 검증이 먼저 필요하다. 기존 앱 JSON의 날짜만으로 아침·저녁 시각이나 기기를 추정해 채우지 않는다.

시연의 낮은 오차는 한 명의 매끄러운 합성 기록에 대한 결과다. 고혈압 탐지율·오탐 감소나 실제 환자의 정확도를 의미하지 않으며 최종 모델 선택에도 사용하지 않는다. [집계 검증 결과](evidence/summary.md)
