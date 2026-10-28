import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { medicationSchema, type Medication } from "../domain/medications";
import { PixelTimePicker } from "./PixelTimePicker";

export function MedicationEditor({
  value,
  onChange,
  conditions = [],
  paged = false,
  onEditingChange,
}: {
  value: Medication[];
  onChange: (value: Medication[]) => void;
  conditions?: string[];
  paged?: boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState<Medication | null>(null);
  const [error, setError] = useState("");
  const [editPage, setEditPage] = useState(0);
  const [listPage, setListPage] = useState(0);
  const editing = draft !== null;
  const supplement = draft?.condition === "영양제" || draft?.condition.startsWith("영양제 · ");
  useEffect(() => onEditingChange?.(editing), [editing, onEditingChange]);
  const listPages = Math.max(1, Math.ceil(value.length / 2));
  const currentListPage = Math.min(listPage, listPages - 1);
  const visibleMedications = paged
    ? value.slice(currentListPage * 2, currentListPage * 2 + 2)
    : value;
  function nextEditorPage() {
    const schema =
      editPage === 0
        ? medicationSchema.pick({ name: true, dose: true })
        : medicationSchema.pick({ condition: true, drugClass: true });
    const result = schema.safeParse(draft);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    setError("");
    setEditPage(editPage + 1);
  }
  function save() {
    const result = medicationSchema.safeParse(draft);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    onChange([...value.filter((med) => med.id !== result.data.id), result.data]);
    setDraft(null);
    setError("");
  }
  return (
    <section className="medication-editor" aria-label="복용 약 등록">
      <p>약이나 영양제의 이름·복용량·시간을 안내받은 그대로 등록해 주세요.</p>
      <ul className="medication-list">
        {visibleMedications.map((med) => (
          <li key={med.id}>
            <div>
              <strong>{med.name}</strong>
              <span>{[med.dose, med.condition].filter(Boolean).join(" · ")}</span>
              <div className="medication-schedule" aria-label="매일 복용 시간">
                {[...med.times].sort().map((time) => (
                  <time key={time} dateTime={time}>
                    {time}
                  </time>
                ))}
              </div>
            </div>
            <div className="medication-row-actions">
              <label>
                <input
                  type="checkbox"
                  checked={med.active}
                  onChange={(e) =>
                    onChange(
                      value.map((item) =>
                        item.id === med.id ? { ...item, active: e.target.checked } : item,
                      ),
                    )
                  }
                />
                복용 중
              </label>
              <button
                type="button"
                aria-label={`${med.name} 수정`}
                onClick={() => {
                  setDraft({ ...med, times: [...med.times].sort() });
                  setError("");
                  setEditPage(0);
                }}
              >
                수정
              </button>
              <button
                type="button"
                aria-label={`${med.name} 삭제`}
                onClick={() => {
                  onChange(value.filter((item) => item.id !== med.id));
                  if (draft?.id === med.id) setDraft(null);
                }}
              >
                삭제
              </button>
            </div>
          </li>
        ))}
      </ul>
      {paged && listPages > 1 && (
        <nav className="medication-list-pages" aria-label="등록한 약 페이지">
          <button
            type="button"
            disabled={currentListPage === 0}
            onClick={() => setListPage(currentListPage - 1)}
          >
            이전 약
          </button>
          <span>
            {currentListPage + 1} / {listPages}
          </span>
          <button
            type="button"
            disabled={currentListPage === listPages - 1}
            onClick={() => setListPage(currentListPage + 1)}
          >
            다음 약
          </button>
        </nav>
      )}
      {!draft ? (
        <button
          type="button"
          className="secondary-button"
          disabled={value.length >= 12}
          onClick={() => {
            setEditPage(0);
            setDraft({
              id: crypto.randomUUID(),
              name: "",
              dose: "",
              condition: "",
              drugClass: "other",
              times: ["08:00"],
              active: true,
            });
          }}
        >
          + 약 / 영양제 등록
        </button>
      ) : (
        <MedicationEditDialog onClose={() => setDraft(null)}>
          <div className="medication-edit-fields">
            {paged && (
              <p className="medication-step-label">
                {["이름과 복용량", "복용 항목", "복용 시간"][editPage]} · {editPage + 1} / 3
              </p>
            )}
            {(!paged || editPage === 0) && (
              <>
                <label>
                  약 / 영양제 이름
                  <input
                    aria-label="약 / 영양제 이름"
                    maxLength={80}
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </label>
                <label>
                  1회 복용량
                  <input
                    aria-label="1회 복용량"
                    maxLength={80}
                    placeholder="예: 처방된 1정"
                    value={draft.dose}
                    onChange={(e) => setDraft({ ...draft, dose: e.target.value })}
                  />
                </label>
              </>
            )}
            {(!paged || editPage === 1) && (
              <>
                <label>
                  {supplement ? "성분" : "관련 질환"}
                  <input
                    aria-label={supplement ? "성분" : "관련 질환"}
                    maxLength={supplement ? 73 : 80}
                    list={supplement ? undefined : "medication-conditions"}
                    value={
                      supplement ? draft.condition.replace(/^영양제(?: · )?/, "") : draft.condition
                    }
                    placeholder={
                      supplement ? "예: 비타민 C · 칼슘" : "예: 혈압 · 혈당 · 기타 · 모름"
                    }
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        condition: supplement
                          ? e.target.value
                            ? "영양제 · " + e.target.value
                            : "영양제"
                          : e.target.value,
                      })
                    }
                  />
                  <datalist id="medication-conditions">
                    {conditions.map((condition) => (
                      <option key={condition} value={condition} />
                    ))}
                  </datalist>
                </label>
                <fieldset className="medication-kind-options">
                  <legend>복용 항목</legend>
                  <label>
                    <input
                      type="radio"
                      name={"medication-kind-" + draft.id}
                      checked={!supplement}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          condition: supplement ? "" : draft.condition,
                        })
                      }
                    />
                    약
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={"medication-kind-" + draft.id}
                      checked={supplement}
                      onChange={() =>
                        setDraft({ ...draft, condition: "영양제", drugClass: "other" })
                      }
                    />
                    영양제
                  </label>
                </fieldset>
              </>
            )}
            {(!paged || editPage === 2) && (
              <fieldset>
                <legend>매일 복용 시간</legend>
                {draft.times.map((time, index) => (
                  <div className="medication-time-row" key={index}>
                    <PixelTimePicker
                      label={`복용 시간 ${index + 1}`}
                      value={time}
                      onChange={(time) =>
                        setDraft({
                          ...draft,
                          times: draft.times.map((value, i) => (i === index ? time : value)),
                        })
                      }
                    />
                    {draft.times.length > 1 && (
                      <button
                        type="button"
                        aria-label={`복용 시간 ${index + 1} 삭제`}
                        onClick={() =>
                          setDraft({ ...draft, times: draft.times.filter((_, i) => i !== index) })
                        }
                      >
                        삭제
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  disabled={draft.times.length >= 6}
                  onClick={() => setDraft({ ...draft, times: [...draft.times, "20:00"] })}
                >
                  + 시간 추가
                </button>
              </fieldset>
            )}
            {error && <p role="alert">{error}</p>}
            <div className="medication-edit-actions">
              {paged && editPage > 0 && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setError("");
                    setEditPage(editPage - 1);
                  }}
                >
                  이전 항목
                </button>
              )}
              {paged && editPage < 2 ? (
                <button type="button" className="primary-button" onClick={nextEditorPage}>
                  다음: {editPage === 0 ? "복용 항목" : "복용 시간"}
                </button>
              ) : (
                <button type="button" className="primary-button" onClick={save}>
                  항목 저장
                </button>
              )}
              <button type="button" onClick={() => setDraft(null)}>
                취소
              </button>
            </div>
          </div>
        </MedicationEditDialog>
      )}
    </section>
  );
}

function MedicationEditDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const prior = document.activeElement;
    const node = ref.current;
    node?.showModal();
    node?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      node?.close();
      if (prior instanceof HTMLElement) prior.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="cream-card medication-edit-dialog"
      aria-labelledby={title}
      onCancel={onClose}
      data-no-swipe
    >
      <header>
        <h2 id={title}>약 / 영양제 등록</h2>
        <button type="button" aria-label="약 등록 닫기" onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
