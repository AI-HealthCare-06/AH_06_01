// The 20 generated PNGs from REXRUN 2.0 / Profile avatars, kept unchanged.
export const profileAvatars = (["male", "female"] as const).flatMap((gender) =>
  [10, 16, 23, 31, 39, 47, 55, 63, 71, 80].map((age, index) => {
    const number = String(index + 1).padStart(2, "0");
    const id = `${gender}-${number}`;
    return {
      id,
      gender,
      age,
      label: `${gender === "male" ? "남성" : "여성"} ${number} · 약 ${age}세`,
      image: `/assets/profile-avatars/${id}-age-${age}.png`,
    };
  }),
);

export function getProfileAvatar(id: string | null) {
  return profileAvatars.find((avatar) => avatar.id === id);
}
