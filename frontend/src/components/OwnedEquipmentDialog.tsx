import { Link } from "react-router-dom";
import { accessories } from "../design/accessories";
import { useGameStore } from "../stores/game-store";
import { InfoDialog } from "./InfoDialog";

export function OwnedEquipmentDialog({
  kind,
  trigger,
  onClose,
}: {
  kind: "head" | "pet" | "all";
  trigger?: HTMLButtonElement;
  onClose: () => void;
}) {
  const { game, equipAccessory } = useGameStore();
  const owned = accessories.filter(
    (item) => game.ownedAccessories.includes(item.id) && (kind === "all" || item.category === kind),
  );
  return (
    <InfoDialog
      title={kind === "head" ? "보유 머리 장식" : kind === "pet" ? "보유 동물 동반" : "보유 아이템"}
      returnFocusTo={trigger}
      onClose={onClose}
      confirmLabel="닫기"
    >
      <div className="equipment-modal-content">
        <div className="equipment-modal-grid">
          {owned.map((item) => {
            const equipped = game.equippedAccessories[item.category] === item.id;
            return (
              <button
                type="button"
                key={item.id}
                aria-label={`${item.name} ${equipped ? "장착 해제" : "장착"}`}
                aria-pressed={equipped}
                onClick={() => equipAccessory(item.id)}
              >
                <img src={item.image} alt="" />
                <strong>{item.name}</strong>
                <small>{equipped ? "✓ 장착 중 · 해제" : "장착하기"}</small>
              </button>
            );
          })}
        </div>
        {!owned.length && <p className="empty-inventory">아직 보유한 아이템이 없어요.</p>}
        <Link to="/shop/customize">꾸미기 상점에서 더 보기 ›</Link>
      </div>
    </InfoDialog>
  );
}
