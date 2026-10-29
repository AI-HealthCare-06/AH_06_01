import { PixelSelect } from "./PixelSelect";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { analyzeDiet, dietLoginRequired, dietStatus } from "../services/diet-service";
import { useDietStore, dietOwner } from "../stores/diet-store";
import {
  blankDietItem,
  canSaveDiet,
  catalogVersion,
  catalogSource,
  legacyCatalogVersion,
  loadOfficialFoods,
  searchFoods,
  displayNutrient,
  foodByCode,
  foods,
  itemNutrition,
  mealSlotLabels,
  nutrientKeys,
  nutrientLabels,
  nutritionSummary,
  validGrams,
  type DietItem,
  type MealSlot,
  type Nutrients,
} from "../domain/diet";
import { localDate } from "../domain/calendar";

export function DietNutrition({
  rows,
  version = catalogVersion,
}: {
  rows: Nutrients[];
  version?: string;
}) {
  const summary = nutritionSummary(rows);
  return (
    <section className="diet-nutrition" aria-label="식단 추정 영양 정보">
      <h3>추정 영양 정보</h3>
      <p>
        {summary.known.energy_kcal} / {summary.count}개 음식의 열량 정보가 연결됐어요.
      </p>
      <div className="diet-main-nutrients">
        {(["energy_kcal", "sodium_mg"] as const).map((key) => (
          <div key={key}>
            <span>{nutrientLabels[key].name}</span>
            <strong>
              {displayNutrient(key, summary.totals[key])}
              <small> {nutrientLabels[key].unit}</small>
            </strong>
            <small>
              {summary.known[key] < summary.count
                ? "일부 음식 합계 · 누락 있음"
                : "확인된 음식 합계"}
            </small>
          </div>
        ))}
      </div>
      {summary.macro && (
        <div className="diet-macros" aria-label="탄수화물 단백질 지방의 열량 비율">
          <div className="diet-macro-track">
            {(["carb", "protein", "fat"] as const).map((key) => (
              <i key={key} className={key} style={{ width: `${summary.macro![key]}%` }} />
            ))}
          </div>
          <p>
            탄수화물 {Math.round(summary.macro.carb)}% · 단백질 {Math.round(summary.macro.protein)}%
            · 지방 {Math.round(summary.macro.fat)}%
          </p>
        </div>
      )}
      <details>
        <summary>영양소 전체 보기</summary>
        <dl>
          {nutrientKeys.map((key) => (
            <div key={key}>
              <dt>{nutrientLabels[key].name}</dt>
              <dd>
                {displayNutrient(key, summary.totals[key])} {nutrientLabels[key].unit}
                {summary.known[key] < summary.count && <small> · 일부 누락</small>}
              </dd>
            </div>
          ))}
        </dl>
      </details>
      <small>
        {version === "mixed"
          ? "각 기록에 보관된 식약처·개발 예시 자료"
          : version === legacyCatalogVersion
            ? "F6 개발용 예시 DB"
            : `식약처 음식 DB (${version.match(/\d{8}/)?.[0].replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3") ?? catalogSource.published_on})`}
        의 100g당 값으로 계산한 참고용 추정치입니다. ‘—’는 결측이며 0이 아닙니다.
        {version !== legacyCatalogVersion && (
          <>
            {" "}
            <a
              href={catalogSource.source_url}
              target="_blank"
              rel="noreferrer"
              aria-label={`${catalogSource.publisher} ${catalogSource.title} 출처`}
            >
              출처
            </a>
          </>
        )}
      </small>
    </section>
  );
}

export function MealAnalysisPanel({ photo }: { photo: string | null }) {
  const owner = useDietStore((state) => state.owner);
  return <DietEditor key={owner ?? "signed-out"} owner={owner} photo={photo} />;
}

function DietEditor({ photo, owner }: { photo: string | null; owner: string | null }) {
  const [capability, setCapability] = useState({ available: false, pending: true });
  const [statusRevision, setStatusRevision] = useState(0);
  const [items, setItems] = useState<DietItem[]>([]);
  const [source, setSource] = useState<"vision" | "manual" | "sample">("manual");
  const [id, setId] = useState<string>(() => crypto.randomUUID());
  const [model, setModel] = useState<string | null>(null);
  const [sourceVersion, setSourceVersion] = useState(catalogVersion);
  const [catalogReady, setCatalogReady] = useState(false);
  const [dbQueries, setDbQueries] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [message, setMessage] = useState("");
  const [date, setDate] = useState(localDate),
    [slot, setSlot] = useState<MealSlot>("lunch");
  const request = useRef<AbortController | null>(null),
    generation = useRef(0);
  useEffect(() => {
    let active = true;
    void loadOfficialFoods()
      .then(() => {
        if (active) setCatalogReady(true);
      })
      .catch(() => {
        if (active) setMessage("공식 영양 DB를 불러오지 못했어요. 새로고침 후 다시 확인해 주세요.");
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void dietStatus(AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]))
      .then((value) => {
        if (!controller.signal.aborted)
          setCapability({ available: value.available, pending: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setCapability({ available: false, pending: false });
      });
    return () => controller.abort();
  }, [statusRevision]);
  useEffect(
    () => () => {
      generation.current++;
      request.current?.abort();
    },
    [],
  );
  async function analyze() {
    if (!photo || !owner || !consent || busy) return;
    const token = ++generation.current,
      controller = new AbortController();
    request.current = controller;
    setItems([]);
    setModel(null);
    setSource("manual");
    setBusy(true);
    setMessage("사진에서 음식과 예상 중량을 확인하고 있어요…");
    setSaved(false);
    setConfirmed(false);
    try {
      const result = await analyzeDiet(
        photo,
        consent,
        AbortSignal.any([controller.signal, AbortSignal.timeout(70000)]),
        owner,
      );
      if (controller.signal.aborted || token !== generation.current || dietOwner() !== owner)
        return;
      setItems(result.items);
      setId(result.id);
      setModel(result.model);
      setSourceVersion(result.catalogVersion);
      setSource("vision");
      setMessage(
        ["음식 이름·DB 조리 상태·실제 먹은 양을 확인해 주세요.", ...result.warnings].join(" "),
      );
    } catch (error) {
      if (!controller.signal.aborted && token === generation.current)
        setMessage(
          error instanceof Error ? error.message : "분석하지 못했어요. 직접 입력할 수 있어요.",
        );
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  function reset(kind: "manual" | "sample") {
    generation.current++;
    request.current?.abort();
    setBusy(false);
    setSource(kind);
    setSourceVersion(kind === "sample" ? legacyCatalogVersion : catalogVersion);
    setDbQueries({});
    setSaved(false);
    setConfirmed(false);
    setId(crypto.randomUUID());
    setModel(null);
    if (kind === "manual") {
      setItems([blankDietItem()]);
      setMessage("음식 이름·중량을 직접 입력해 주세요.");
    } else {
      setItems(
        ["쌀밥", "김치찌개", "배추김치"].map((name, index) => {
          const food = foods.find((row) => row.name === name && row.food_code.startsWith("DEV-"))!;
          return {
            ...blankDietItem(),
            name,
            nameInput: name,
            foodCode: food.food_code,
            grams: String([210, 350, 50][index]),
          };
        }),
      );
      setMessage(
        "공유본의 결과 예시입니다. 현재 사진을 분석한 결과가 아니며 저장·퀘스트 완료에 쓰이지 않아요.",
      );
    }
  }
  function edit(id: string, patch: Partial<DietItem>) {
    setConfirmed(false);
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }
  function save() {
    if (!owner || !canSaveDiet(items, source, confirmed) || source === "sample") return;
    const accepted = useDietStore.getState().save(
      {
        id,
        date,
        slot,
        source,
        catalogVersion: sourceVersion,
        model,
        createdAt: new Date().toISOString(),
        items: items.map((item) => ({ ...item, nutrients: itemNutrition(item) })),
      },
      owner,
    );
    setSaved(accepted);
    setMessage(
      accepted
        ? "식단 기록을 이 기기에 저장했어요. 퀘스트는 완료 화면에서 별도로 확인해 주세요."
        : "저장하지 못했어요. 날짜·로그인·기기 저장 공간을 확인해 주세요.",
    );
  }
  return (
    <section className="meal-analysis-panel" aria-label="식단 사진 분석">
      <header>
        <div>
          <small>MEAL ANALYSIS</small>
          <h3>식단 분석</h3>
        </div>
        <Link to="/meals">기록 보기 ›</Link>
      </header>
      <p>사진의 음식명·예상 제공량을 확인하고, 실제 먹은 양으로 수정해 기록해요.</p>
      {photo && (
        <>
          <label className="diet-check">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy || saved}
              onChange={(event) => setConsent(event.target.checked)}
            />
            이 사진을 분석 서버와 OpenAI에 전송하는 데 동의합니다.
          </label>
          <small className="diet-photo-note">
            분석 서버는 사진을 영구 보관하지 않습니다. 사진 인증만 이용하면 외부 AI로 보내지 않아요.
          </small>
        </>
      )}
      {dietLoginRequired && (
        <p className="diet-connection-note">
          사진 분석은 실제 계정으로 로그인한 뒤 이용할 수 있어요. 데모에서는 직접 입력과 결과 예시를
          사용할 수 있어요.
        </p>
      )}
      {!capability.pending && !capability.available && (
        <p className="diet-connection-note">
          사진 분석 서버 연결 전입니다. 직접 입력하거나 결과 예시를 볼 수 있어요.{" "}
          <button type="button" onClick={() => setStatusRevision((value) => value + 1)}>
            연결 다시 확인
          </button>
        </p>
      )}
      <div className="diet-actions">
        {photo && (
          <button
            className="primary-button"
            type="button"
            disabled={
              busy || saved || !consent || !owner || !capability.available || dietLoginRequired
            }
            onClick={() => void analyze()}
          >
            {busy ? "분석 중…" : "사진으로 분석"}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => reset("manual")}>
          직접 입력
        </button>
        <button type="button" disabled={busy} onClick={() => reset("sample")}>
          결과 예시 보기
        </button>
        {busy && (
          <button
            type="button"
            onClick={() => {
              generation.current++;
              request.current?.abort();
              setBusy(false);
              setMessage("분석 요청을 중단했어요.");
            }}
          >
            분석 중단
          </button>
        )}
      </div>
      <p className="diet-status" role="status">
        {message ||
          (capability.pending
            ? "분석 연결을 확인하고 있어요."
            : "사진 전송 동의 후 분석하거나 직접 입력할 수 있어요.")}
      </p>
      {items.length > 0 && (
        <>
          <p className="diet-result-source">
            {source === "sample"
              ? "결과 예시 · 현재 사진 분석 아님"
              : source === "vision"
                ? "AI 사진 분석 · 음식과 중량 확인 필요"
                : "직접 입력"}
          </p>
          <div className="diet-record-fields">
            <label>
              식사 날짜
              <input
                type="date"
                value={date}
                max={localDate()}
                disabled={saved || busy}
                onChange={(event) => {
                  setDate(event.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
            <label>
              끼니
              <PixelSelect
                value={slot}
                disabled={saved || busy}
                onValueChange={(value) => {
                  setSlot(value as MealSlot);
                  setConfirmed(false);
                }}
              >
                {Object.entries(mealSlotLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </PixelSelect>
            </label>
          </div>
          <div className="diet-items">
            {items.map((item, index) => (
              <fieldset className="diet-item" key={item.id} disabled={saved || busy}>
                <legend>
                  음식 {index + 1}
                  {item.needsReview ||
                  !item.foodCode ||
                  (item.confidence !== null && item.confidence < 0.8)
                    ? " · 확인 필요"
                    : ""}
                </legend>
                {source === "vision" && (
                  <small>
                    AI 제안: {item.nameInput}
                    {item.portionHint ? ` · ${item.portionHint}` : ""}
                  </small>
                )}
                <label>
                  음식 이름
                  <input
                    aria-label={`음식 ${index + 1} 이름`}
                    value={item.name}
                    maxLength={80}
                    onChange={(event) =>
                      edit(item.id, { name: event.target.value, foodCode: null })
                    }
                  />
                </label>
                <label>
                  영양 DB 검색
                  <input
                    aria-label={`음식 ${index + 1} DB 검색`}
                    value={dbQueries[item.id] ?? ""}
                    placeholder="예: 쌀밥, 김치찌개"
                    disabled={!catalogReady}
                    onChange={(event) =>
                      setDbQueries((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  />
                </label>
                <label>
                  영양 DB 연결
                  <PixelSelect
                    aria-label={`음식 ${index + 1} 영양 DB`}
                    value={item.foodCode ?? ""}
                    onValueChange={(value) => {
                      const food = foodByCode(value);
                      edit(item.id, {
                        foodCode: food?.food_code ?? null,
                        ...(food ? { name: food.name } : {}),
                      });
                    }}
                  >
                    <option value="">미연결 · 이름으로만 기록</option>
                    {Array.from(
                      new Map(
                        [
                          ...(item.foodCode && foodByCode(item.foodCode)
                            ? [foodByCode(item.foodCode)!]
                            : []),
                          ...(item.suggestedCode && foodByCode(item.suggestedCode)
                            ? [foodByCode(item.suggestedCode)!]
                            : []),
                          ...searchFoods(
                            dbQueries[item.id] ?? "",
                            40,
                            sourceVersion === legacyCatalogVersion,
                          ),
                        ].map((food) => [food.food_code, food]),
                      ).values(),
                    ).map((food) => (
                      <option key={food.food_code} value={food.food_code}>
                        {food.name}
                        {food.origin ? ` · ${food.origin}` : ""}
                      </option>
                    ))}
                  </PixelSelect>
                </label>
                {!item.foodCode && (
                  <p className="diet-missing">
                    영양값이 없습니다.
                    {item.suggestedCode && foodByCode(item.suggestedCode)
                      ? ` ‘${foodByCode(item.suggestedCode)!.name}’인지 확인하고 위에서 선택해 주세요.`
                      : " 일치하는 음식이 있으면 위에서 선택해 주세요."}
                  </p>
                )}
                <label>
                  실제 먹은 양 (g)
                  <input
                    aria-label={`음식 ${index + 1} 중량`}
                    inputMode="decimal"
                    value={item.grams}
                    placeholder="예: 150"
                    onChange={(event) => edit(item.id, { grams: event.target.value })}
                  />
                </label>
                {item.grams && !validGrams(item.grams) && (
                  <small className="diet-missing">5~1,500g 범위의 숫자를 입력해 주세요.</small>
                )}
                {(foodByCode(item.foodCode)?.serving_g || item.estimatedGrams) && (
                  <div
                    className="diet-portion-actions"
                    role="group"
                    aria-label={`음식 ${index + 1} 분량 보정`}
                  >
                    {item.estimatedGrams !== null && (
                      <button
                        type="button"
                        onClick={() => edit(item.id, { grams: String(item.estimatedGrams) })}
                      >
                        사진 추정량 {item.estimatedGrams}g
                      </button>
                    )}
                    {foodByCode(item.foodCode)?.serving_g &&
                      ([1, 0.5, 0.25] as const).map((ratio) => (
                        <button
                          key={ratio}
                          type="button"
                          onClick={() =>
                            edit(item.id, {
                              grams: String(
                                Math.round(foodByCode(item.foodCode)!.serving_g! * ratio),
                              ),
                            })
                          }
                        >
                          참고 제공량 {ratio === 1 ? "1인분" : ratio === 0.5 ? "1/2" : "1/4"}
                        </button>
                      ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setItems((current) => current.filter((row) => row.id !== item.id));
                    setConfirmed(false);
                  }}
                >
                  음식 {index + 1} 삭제
                </button>
              </fieldset>
            ))}
          </div>
          <button
            type="button"
            disabled={saved || busy || items.length >= 12}
            onClick={() => {
              setItems((current) => [...current, blankDietItem()]);
              setConfirmed(false);
            }}
          >
            + 음식 추가
          </button>
          <DietNutrition rows={items.map(itemNutrition)} version={sourceVersion} />
          {source !== "sample" && (
            <>
              <label className="diet-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={saved || busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                음식 이름과 실제 먹은 양을 확인했습니다.
              </label>
              <button
                className="primary-button diet-save"
                type="button"
                onClick={save}
                disabled={
                  busy ||
                  saved ||
                  !canSaveDiet(items, source, confirmed) ||
                  !owner ||
                  !date ||
                  date > localDate()
                }
              >
                {saved ? "식단 저장 완료" : "확인한 식단 기록 저장"}
              </button>
            </>
          )}
        </>
      )}
      <p className="diet-footnote">
        개발용 DB 기반 추정치이며 진단·처방이나 식단 적합성 판정이 아닙니다. 식단 기록은 현재 기기에
        계정별로 저장되며 다른 기기로 자동 동기화되지 않아요.
      </p>
    </section>
  );
}
