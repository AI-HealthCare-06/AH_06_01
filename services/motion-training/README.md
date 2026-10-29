# 식단·모션 개선 구현 및 검증

작업 브랜치: `feature/diet-motion-performance`. 선택된 식단 1+2, 모션 3+4 조합의 코드와 데이터 준비 도구를 구현했다. **전용 도구·과정 모델은 실제 라벨 자료가 없어 아직 학습되지 않았다.** 규칙 시연이나 테스트 픽스처를 학습 성능으로 표시하지 않는다.

## 식단: 이미지 분석과 영양 DB 분리

- 현재 API 키에서 사용 가능한 상위 모델 `gpt-4o`를 기본값으로 설정했다. 서버 `VISION_MODEL`로 변경 가능하다. 비교 후보 `gpt-5.4-mini`는 이 프로젝트 키에서 HTTP 403 / `model_not_found`로 거절됐다. 자동으로 다른 모델을 호출하며 비용을 늘리는 재시도는 하지 않는다.
- 전체 사진은 EXIF 방향을 보정하고 메타데이터를 제거해 최대 2048px JPEG로 처리한다. 이미지 `detail: high`, 닫힌 JSON Schema, 출력 토큰 상한을 적용했다. 음식 이름을 먼저 독립적으로 인식한다. DB 목록의 앞부분을 프롬프트에 넣어 특정 음식에 편향시키지 않는다.
- 불확실하거나 DB에 정확히 연결되지 않은 음식은 유효한 ROI가 있을 때 최대 2개를 확대 재확인한다. 전체 요청 최대 3회, 전체 60초, 확대당 최대 12초. 확대 실패는 경고로 남기고 전체 사진 결과를 유지한다. 확대 결과로 실제 중량을 덮어쓰지 않는다.
- 사진만으로 분량을 알 수 없으면 `estimated_g: null`. DB 제공량을 자동으로 먹은 양으로 간주하지 않는다. 사용자가 음식·조리 상태·그램을 확인해야 저장된다. 참고 제공량 1 / 1/2 / 1/4 버튼과 음식 검색을 추가했다.
- [식약처 K-FIND 음식 DB](https://various.foodsafetykorea.go.kr/nutrient/general/down/historyList.do)의 2026-09-29 자료를 정규화했다. 100g 기준 13,954개를 포함하고, 100ml 기준 5,784개는 밀도를 임의 가정하지 않도록 제외했다. 결측/미량/해석 불가능한 값은 0으로 바꾸지 않는다. 정확하지 않은 이름 매칭은 후보만 제시하고 다른 음식의 영양값을 자동 할당하지 않는다.
- 카탈로그 버전 `mfds-kddb-20260929-70bd270e`. 원본 SHA-256·배포일·변환 기준은 `services/diet-f6/data/catalog-source.json`에 보관한다. 원본 엑셀은 Git에 넣지 않는다. 프런트엔드 공식 DB는 필요할 때 별도 청크로 불러온다.
- 기존 `f6-dev-sample-v1` 저장 기록과 영양 스냅샷을 유지한다. 새 공식 DB를 과거 기록에 소급 덮어쓰지 않는다. 개발 예시는 저장/퀘스트 증거로 쓸 수 없다.

실제 개발용 쌀밥 사진 1장의 동일 v3 프로토콜 비교(2026-10-29):

| 모델 | 음식 연결 | 중량 | 전체 인식 호출 | 소요 |
| --- | --- | --- | --- | --- |
| gpt-4o-mini | 밥 → 공식 쌀밥 D301-022000000-0001 | 미확정 | 1 | 3,064ms |
| gpt-4o | 밥 → 같은 공식 항목 | 미확정 | 1 | 2,221ms |

표본 1장이라 정확도·속도 향상률을 계산하지 않는다. 기준 중량이 없어 분량 오차도 측정하지 않았다. 이 비교는 같은 새 프로토콜에서 모델만 비교한 것으로, 기존 코드 전체와의 대조 실험이 아니다. 여러 음식이 섞인 실제 식사와 계량된 분량의 평가 세트가 추가로 필요하다.

재현 도구(서버용 키는 환경 또는 지정 `.env`, 명령이나 출력에 키를 넣지 않는다):

```powershell
$env:PYTHONPATH = (Resolve-Path services/diet-f6).Path
python services/diet-f6/tools/benchmark_models.py <개발용-사진> --models gpt-4o-mini,gpt-4o --output .cache/model-comparison.json --run-api
python services/diet-f6/tools/import_mfds_catalog.py --help
```

벤치마크의 `--run-api`는 외부 전송과 API 비용을 명시적으로 켜는 옵션이다. 실제 사용자 사진으로 자동 실행하지 않는다. [OpenAI 이미지 입력](https://developers.openai.com/api/docs/guides/images-vision), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)를 기준으로 구현했다.

## 모션: Android 네이티브 추론

`MotionVision` Capacitor 플러그인을 추가했다. CameraX 1.5.1 + Android MediaPipe Tasks Vision 1.2.0을 사용한다. 브라우저의 npm 패키지 1.0.1과 Android Maven 패키지 버전은 별개다.

- 전면 카메라의 전체 화각과 종횡비를 유지한다. 사진/Base64/ImageBitmap을 WebView 브리지로 보내지 않는다. 얼굴의 4개 기준점, 손의 21개 점, 객체 상자와 처리 지표만 전달한다. 브라우저에서는 기존 Worker 경로를 유지한다.
- 단일 추론 스레드에서 모델 생성·추론·해제를 처리한다. GPU 초기화가 실패하면 CPU로 전환하고 실제 선택된 delegate를 보고한다. CameraX `KEEP_ONLY_LATEST`, 80~250ms 적응 간격, 얼굴·객체 탐지 간격과 만료 시간을 적용했다.
- 중복·역순 타임스탬프 및 이전 세션 이벤트를 버린다. 회전/화면 크기가 바뀌면 추적과 투약 부위를 초기화한다. 종료·백그라운드 이동·취소 시 카메라와 모델을 해제한다.
- 추론 처리 p50/p95, 처리 프레임, 간격 제한 프레임을 보고한다. 네이티브 p50/p95는 전처리·추론을 포함한 프레임 처리 시간이며 화면 표시·브리지까지 포함한 종단 지연 또는 카메라 FPS와 동일하지 않다.
- 주사/인슐린은 사용자가 관찰 부위를 지정한다. 사용자 도구 선택을 자동 도구 인식 결과로 취급하지 않는다.

네이티브 플러그인은 **다음 APK 빌드·설치가 필요**하다. 웹 OTA만으로 기존 APK에 네이티브 코드를 추가할 수 없다. 새 플러그인이 없는 APK는 Worker를 사용한다. 이번 작업은 운영 배포/릴리스 요청이 아니므로 브랜치에서 검증한다. 연결 기기가 현재 ADB에 없어 Galaxy 실제 FPS·발열·카메라 시야 정합은 미측정이다.

## 전용 도구 모델 학습

대상 클래스는 `pill`, `insulin_pen`, `syringe`. 기본 `frontend/public/models/motion-capture/tool-model.json`은 `validated:false`다. 학습된 가중치를 꾸며 넣지 않았다. 검증된 TFLite가 공급되면 네이티브와 Worker가 SHA-256·레이블·평가 메타데이터를 확인해 추가 탐지기로 연결한다. 모델이 연결됐을 때 복약/투약 동작은 해당 도구의 실제 관찰 근거도 요구한다. 바늘 삽입·실제 주입·삼킴·용량을 증명하는 기능은 아니다.

먼저 실제 도구 사진에 상자를 라벨링해야 한다. 작은 알약, 손에 가림, 조명, 촬영 거리, 피부색/손 모양, 비슷한 펜·빈손·얼굴 만짐 등의 음성 사례를 포함한다. 같은 영상의 인접 프레임을 학습/평가에 나눠 넣지 않는다.

```text
dataset/
  train/images/...        train/labels.json
  validation/images/...   validation/labels.json
  test/images/...         test/labels.json
```

표준 COCO에 다음 메타데이터를 추가한다. 클래스 ID는 `1:pill, 2:insulin_pen, 3:syringe`. 각 이미지에 `subject_id: "P01"`, `synthetic: false`를 기록한다. 이미지 파일은 해당 split의 `images/` 내부에 있어야 한다. 빈 도구/혼동 사례는 annotations가 없는 이미지로 넣는다. 촬영자 기준 train 최소 2명, validation/test 각각 별도 1명 이상이 필요하다. 검사기의 상자/이미지 최소 개수는 실행 가능성을 위한 하한이며 충분한 성능을 보장하는 표본 크기가 아니다.

```powershell
python services/motion-training/train_tools.py <dataset> --validate-only
# 별도 학습 환경에 mediapipe-model-maker를 준비한 뒤 실행
python services/motion-training/train_tools.py <dataset> --output .cache/motion-tools/run-001
```

[공식 Object Detector 커스터마이징 API](https://developers.google.com/edge/mediapipe/solutions/customization/object_detector)를 사용한다. **Model Maker는 현재 적극 유지보수되지 않으므로 별도 고정 학습 환경에서 호환성을 검증해야 한다.** 이번에는 학습 데이터와 해당 환경이 없어 실제 학습을 실행하지 않았다. validation으로 학습을 조정하고, 분리된 test의 AP ≥ 0.5를 통과해야 `tool-model.json`을 내보낸다. 이 값은 초기 개발용 활성화 기준이며 의료 검증 기준이 아니다. 미통과 시 평가만 저장하고 활성화 파일을 만들지 않는다.

검증된 `tool-<hash>.tflite`와 manifest를 `frontend/public/models/motion-capture/`에 함께 배치해 빌드한다. 기존 manifest를 `validated:true`로 바꾸는 것만으로는 활성화할 수 없다. 현재 저장소의 모델 준비 스크립트는 기본 모델만 받으므로, 향후 CI 배포에는 실제 검증된 전용 가중치의 비공개 빌드 입력도 공급해야 한다.

## 과정 시계열 학습·평가

`/cv` → **학습 및 검증 기록** → **동작 특징 기록에 동의해요**를 켠다. 같은 사람에게 같은 익명 코드(P01 등)를 부여한다. 관찰을 종료한 뒤 실제로 수행한 동작 라벨을 직접 선택하고 JSON을 저장한다. Android 전면 카메라에도 특징 확인용 관찰 종료 버튼을 넣었다. 영상/음성/원본 관절 좌표는 내보내지 않는다. 기본값은 기록 안 함이며 서버 업로드는 없다.

- 16개 정규화 숫자 특징: 손·컵과 입의 거리, 집기, 컵의 탐지/추적·나이, 얼굴/손 가시성, 지정 부위 거리, 유효성, 3개 도구의 관찰 점수, 도구 모델 준비 여부.
- 라벨: `water`, `oral`, `insulin_pen`, `syringe`, `negative`. 20~900프레임, 최소 1.8초, 최대 65초. 합성 시연·자동 추정 라벨·원본 좌표를 학습 자료로 사용하지 않는다. 경구/주사 과정 학습은 실제 전용 도구 탐지 근거가 있는 기록부터 허용한다.
- 시간축을 32점으로 재표본화한 뒤 DTW + 촬영자별 대표 시퀀스를 학습한다. 프레임을 무작위로 섞지 않는다. 사람 기준으로 분리하고 복사된 기록을 거절한다. 최소 3명, 각 참가자/라벨 최소 2개 기록과 별도 평가의 혼동 사례가 필요하다.
- 실제 라벨이 구분되지 않으면 학습을 실패시킨다. 분리 평가 macro-F1 ≥ 0.8 및 각 양성 라벨 precision ≥ 0.9를 충족해야 모델을 내보낸다. 작은 자료에서 이 조건을 충족해도 일반화가 보장되지 않으므로 기기·환경·사람을 늘린 후 재평가해야 한다.

```powershell
python services/motion-training/train_sequence.py <실제-특징-JSON-폴더> --output .cache/motion-sequence/run-001
```

결과 `sequence-model.json`을 `/cv`의 모델 불러오기로 등록한다. 아직 등록된 모델이 없으면 규칙 기반임을 표시한다. 모델이 등록되면 동작 규칙과 학습된 시퀀스가 함께 일치해야 감지로 표시하고, 음성/불확실 분류는 확인 불충분으로 종료한다. 이 실험 화면은 복약 기록/퀘스트 보상을 자동 생성하지 않는다.

## 검증 범위

- 프런트엔드 형식 검사·lint·331개 단위 테스트와 프로덕션 빌드 통과.
- 식단 API·공식 DB·확대 재확인·실제 학습 입력 제한/누수 검사 25개 Python 테스트 통과.
- Android 디버그 APK 빌드·프레임 제어 단위 테스트 통과. 실제 기기 측정은 연결 후 필요.
- 식단·CV 브라우저 검증: 음식 검색/분량/기록 유지, API 실패, 늦은 응답, 실제 Worker의 빈 영상 거절, 합성 입력의 퀘스트 차단, 320/390/430px 레이아웃을 확인했다.
- 전체 브라우저 실행은 236개 통과, 14개 연결/옵션 검사 생략. 스와이프 1건과 디스크 부족으로 종료한 2건을 개별 재실행해 모두 통과했다. 추가한 특징 내보내기 검사도 통과했다. 생략된 실제 연결 검사를 통과로 세지 않는다.
- 가중치 학습/평가 수치와 실제 사람의 복약·주사 인식률은 아직 없다. 테스트 픽스처와 실제 학습 자료를 혼용하지 않는다.
