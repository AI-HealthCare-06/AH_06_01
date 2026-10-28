import { useAvatarMedia } from "../services/avatar-media";
import { assets } from "../design/assets";
import { getProfileAvatar } from "../design/profile-avatars";
import { useProfileStore } from "../stores/profile-store";

export function ProfileAvatar() {
  const { image } = useAvatarMedia();
  const avatarId = useProfileStore((s) => s.avatarId);
  const name = useProfileStore((s) => s.profile.name);
  const avatar = getProfileAvatar(avatarId);
  return (
    <span className="profile-avatar" data-avatar={image ? "custom" : (avatar?.id ?? "default")}>
      <img
        src={image ?? avatar?.image ?? assets.home.imgAvatarFrame}
        alt={`${name} 님의 프로필 이미지`}
      />
    </span>
  );
}
