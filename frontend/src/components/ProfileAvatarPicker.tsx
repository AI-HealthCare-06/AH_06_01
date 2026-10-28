import { useState } from "react";
import { useAvatarMedia } from "../services/avatar-media";
import { profileAvatars, getProfileAvatar } from "../design/profile-avatars";
import { assets } from "../design/assets";
import { useProfileStore } from "../stores/profile-store";
import { ProfileAvatar } from "./ProfileAvatar";
import { InfoDialog } from "./InfoDialog";

export function ProfileAvatarPicker({
  onClose,
  returnFocusTo,
}: {
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
}) {
  const { avatarId, setAvatar, profile } = useProfileStore();
  const media = useAvatarMedia();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function choose(id: string | null) {
    media.clear();
    setAvatar(id);
  }
  const selected = getProfileAvatar(avatarId);
  return (
    <InfoDialog
      title="프로필 이미지 선택"
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      confirmLabel="닫기"
    >
      <div className="profile-avatar-picker" data-no-swipe>
        <div className="avatar-picker-current">
          <ProfileAvatar />
          <div>
            <strong aria-live="polite">
              {media.image ? "내 이미지 / GIF" : (selected?.label ?? "기본 아바타")} 사용 중
            </strong>
            <p>선택하면 바로 적용돼요.</p>
          </div>
        </div>
        <button
          className="avatar-default-choice"
          aria-pressed={!media.image && avatarId === null}
          onClick={() => choose(null)}
        >
          <img src={assets.home.imgAvatarFrame} alt="" />
          기본 아바타
        </button>
        <label className="avatar-upload-choice">
          내 이미지 / GIF 선택
          <input
            aria-label="기기 이미지 또는 GIF 선택"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              setError("");
              try {
                await media.upload(file);
              } catch (err) {
                setError(err instanceof Error ? err.message : "이미지를 확인해 주세요.");
              } finally {
                setBusy(false);
                e.target.value = "";
              }
            }}
          />
        </label>
        <small>2MB 이하 · 이 기기에만 저장돼요.</small>
        {error && <p role="alert">{error}</p>}
        <div className="avatar-picker-options" tabIndex={0} aria-label="내 성별 아바타 목록">
          {[profile.sex].map((gender) => (
            <section key={gender} aria-label={`${gender === "male" ? "남성" : "여성"} 아바타 10개`}>
              <h3>
                {gender === "male" ? "남성" : "여성"} <small>10개</small>
              </h3>
              <div className="profile-avatar-grid">
                {profileAvatars
                  .filter((avatar) => avatar.gender === gender)
                  .map((avatar) => (
                    <button
                      key={avatar.id}
                      aria-label={`${avatar.label} 프로필 선택`}
                      aria-pressed={!media.image && avatarId === avatar.id}
                      onClick={() => choose(avatar.id)}
                    >
                      <img
                        src={avatar.image}
                        alt=""
                        width="128"
                        height="128"
                        loading="lazy"
                        decoding="async"
                      />
                      <span>{avatar.age}세</span>
                      {avatarId === avatar.id && <b aria-hidden="true">✓</b>}
                    </button>
                  ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </InfoDialog>
  );
}
