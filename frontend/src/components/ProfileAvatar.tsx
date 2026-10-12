import { assets } from "../design/assets";

export function ProfileAvatar() {
  return (
    <span className="profile-avatar">
      <img src={assets.home.imgAvatarFrame} alt="민 님의 프로필 사진" />
    </span>
  );
}
