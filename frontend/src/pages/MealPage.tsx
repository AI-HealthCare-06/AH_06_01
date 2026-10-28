import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell, PageHeading } from "../components/AppShell";
import { DietNutrition, MealAnalysisPanel } from "../components/MealAnalysisPanel";
import { mealSlotLabels } from "../domain/diet";
import { localDate } from "../domain/calendar";
import { useDietStore } from "../stores/diet-store";

export function MealPage() {
  const [photo, setPhoto] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [message, setMessage] = useState("");
  const [date, setDate] = useState(localDate);
  const records = useDietStore((state) => state.records),
    generation = useRef(0);
  const dayRecords = records.filter((record) => record.date === date);
  async function load(file: File | undefined) {
    const token = ++generation.current;
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setMessage("10MB 이하 JPEG·PNG·WEBP 사진을 선택해 주세요.");
      return;
    }
    try {
      const value = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("사진을 읽지 못했어요."));
        reader.readAsDataURL(file);
      });
      if (token !== generation.current) return;
      setPhoto(value);
      setRevision((value) => value + 1);
      setMessage("사진을 확인한 뒤 분석을 선택해 주세요.");
    } catch {
      setMessage("사진을 읽지 못했어요. 다시 선택해 주세요.");
    }
  }
  return (
    <AppShell active="quests">
      <Link className="quest-auth-back" to="/home">
        ← 홈
      </Link>
      <PageHeading title="MEAL JOURNAL" subtitle="음식과 먹은 양을 확인하고 나의 식단을 기록해요" />
      <section className="cream-card meal-upload">
        <h3>식사 사진 선택</h3>
        <label className="meal-file-picker">
          <span>{photo ? "사진 변경" : "사진 선택"}</span>
          <input
            aria-label="분석할 식사 사진"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const selected = event.target.files?.[0];
              event.target.value = "";
              void load(selected);
            }}
          />
        </label>
        <small>JPEG · PNG · WEBP / 최대 10MB</small>
        <p role="status">{message}</p>
        {photo && (
          <>
            <img src={photo} alt="분석할 식사 사진 미리보기" />
            <button
              type="button"
              onClick={() => {
                generation.current++;
                setPhoto(null);
                setRevision((value) => value + 1);
                setMessage("");
              }}
            >
              선택한 사진 지우기
            </button>
          </>
        )}
        <small>
          사진 선택만으로 전송되지 않아요. 앱 카메라에서 촬영한 사진도 식사 인증 화면에서 분석할 수
          있어요.
        </small>
      </section>
      <MealAnalysisPanel key={revision} photo={photo} />
      <section className="cream-card meal-history" aria-label="저장한 식단 기록">
        <header>
          <h3>나의 식단 기록</h3>
          <input
            aria-label="식단 기록 날짜"
            type="date"
            max={localDate()}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </header>
        {dayRecords.length ? (
          <>
            <DietNutrition
              rows={dayRecords.flatMap((record) => record.items.map((item) => item.nutrients))}
            />
            <ol>
              {dayRecords.map((record) => (
                <li key={record.id}>
                  <header>
                    <strong>{mealSlotLabels[record.slot]}</strong>
                    <span>{record.source === "vision" ? "사진 분석 후 확인" : "직접 입력"}</span>
                  </header>
                  <p>{record.items.map((item) => `${item.name} ${item.grams}g`).join(" · ")}</p>
                  <button type="button" onClick={() => useDietStore.getState().remove(record.id)}>
                    이 식단 기록 삭제
                  </button>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p>이 날짜에 저장한 식단 기록이 없어요.</p>
        )}
        <p className="diet-footnote">
          이 기기에 저장한 기록만 표시합니다. 사진과 AI 전송 동의는 보관하지 않습니다.
        </p>
      </section>
    </AppShell>
  );
}
