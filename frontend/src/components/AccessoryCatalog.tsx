import { useState } from "react";
import { Link } from "react-router-dom";
import { accessories } from "../design/accessories";
import { useGameStore } from "../stores/game-store";
import { InfoDialog } from "./InfoDialog";
import { useNotice } from "./NoticeProvider";

export function AccessoryCatalog({ inventory = false }: { inventory?: boolean }) {
  const { game, buyAccessory, equipAccessory } = useGameStore();
  const [category, setCategory] = useState("all");
  const [preview, setPreview] = useState<{
    item: (typeof accessories)[number];
    trigger: HTMLButtonElement;
  } | null>(null);
  const notice = useNotice();
  const items = accessories.filter((item) => !inventory || game.ownedAccessories.includes(item.id));
  return (
    <section
      className="accessory-catalog"
      aria-label={inventory ? "보유한 꾸미기 아이템" : "꾸미기 상품"}
    >
      <header>
        <h3>{inventory ? "MY ITEMS" : "DINO ITEMS"}</h3>
        <Link to={inventory ? "/shop/customize" : "/character"}>
          {inventory ? "꾸미기 상점 ›" : "보유 아이템 ›"}
        </Link>
      </header>
      <div className="accessory-filters" aria-label="꾸미기 분류">
        {[
          ["all", "전체"],
          ["head", "머리"],
          ["pet", "동물"],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={category === id} onClick={() => setCategory(id)}>
            {label} {items.filter((item) => id === "all" || item.category === id).length}
          </button>
        ))}
      </div>
      {(["head", "pet"] as const)
        .filter((kind) => category === "all" || category === kind)
        .map((kind) => (
          <section key={kind} className="accessory-category">
            <h4>
              {kind === "head" ? "머리 치장 아이템" : "동물 동반 아이템"}
              <small>{items.filter((item) => item.category === kind).length} ITEMS</small>
            </h4>
            <div className="accessory-grid">
              {items
                .filter((item) => item.category === kind)
                .map((item) => {
                  const owned = game.ownedAccessories.includes(item.id);
                  const equipped = game.equippedAccessories[kind] === item.id;
                  return (
                    <button
                      key={item.id}
                      className="accessory-item"
                      aria-label={`${item.name} ${inventory ? (equipped ? "장착 해제" : "장착") : "미리보기"}`}
                      data-equipped={equipped}
                      onClick={(event) => {
                        if (inventory) equipAccessory(item.id);
                        else setPreview({ item, trigger: event.currentTarget });
                      }}
                    >
                      <img src={item.image} alt="" loading="lazy" />
                      <strong>{item.name}</strong>
                      <span>
                        <small>{kind.toUpperCase()}</small>
                        <b>
                          {inventory
                            ? equipped
                              ? "✓ 장착 중"
                              : "장착하기"
                            : owned
                              ? "보유 중"
                              : `● ${item.price}`}
                        </b>
                      </span>
                    </button>
                  );
                })}
            </div>
            {!items.some((item) => item.category === kind) && (
              <p className="empty-inventory">상점에서 마음에 드는 아이템을 골라보세요.</p>
            )}
          </section>
        ))}
      {preview && (
        <InfoDialog
          title={preview.item.name}
          returnFocusTo={preview.trigger}
          onClose={() => setPreview(null)}
          confirmLabel={
            game.ownedAccessories.includes(preview.item.id)
              ? "보유 중 · 확인"
              : game.gold < preview.item.price
                ? "GOLD 부족 · 확인"
                : `${preview.item.price} GOLD로 구매`
          }
          onConfirm={
            game.ownedAccessories.includes(preview.item.id) || game.gold < preview.item.price
              ? undefined
              : () => {
                  const bought = buyAccessory(preview.item.id);
                  notice(
                    bought
                      ? `${preview.item.name} 구매 완료! 캐릭터에서 장착할 수 있어요.`
                      : "구매할 수 없어요. 보유 아이템과 GOLD를 확인해 주세요.",
                  );
                  setPreview(null);
                }
          }
        >
          <img className="accessory-preview" src={preview.item.image} alt={preview.item.name} />
          <p>머리 장식과 동물은 한 종류씩 장착할 수 있어요. 능력치는 바뀌지 않아요.</p>
          <p>보유 GOLD {game.gold.toLocaleString()}</p>
        </InfoDialog>
      )}
    </section>
  );
}

export function EquippedAccessories({ className = "" }: { className?: string }) {
  const equipped = useGameStore((state) => state.game.equippedAccessories);
  return (
    <span className={`equipped-accessories ${className}`} aria-hidden="true">
      {accessories
        .filter((item) => equipped[item.category] === item.id)
        .map((item) => (
          <img key={item.id} className={`equipped-${item.category}`} src={item.image} alt="" />
        ))}
    </span>
  );
}
