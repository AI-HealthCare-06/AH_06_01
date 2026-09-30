import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { dinosaurs } from "../design/dinosaurs";
import { getSkin, skins } from "../design/skins";
import { type SkinId } from "../domain/appearance";
import { useGameStore } from "../stores/game-store";
import { DinosaurArt } from "./DinosaurArt";
import { AccessoryCatalog, EquippedAccessories } from "./AccessoryCatalog";
import { GoldEffects } from "./GameWallet";
import { PageHeading } from "./AppShell";
import { useNotice } from "./NoticeProvider";

export function CharacterVault() {
  const { game, customizeDinosaur } = useGameStore();
  const [params, setParams] = useSearchParams();
  const inventory = params.get("tab") === "accessories";
  const [selected, setSelected] = useState(game.dinosaur);
  const [skin, setSkin] = useState<SkinId>(game.dinosaurStyles[selected]);
  const notice = useNotice();
  const choose = (index: number) => {
    setSelected((index + 6) % 6);
    setSkin(game.dinosaurStyles[(index + 6) % 6]);
  };
  const dino = dinosaurs[selected];
  const equipped = selected === game.dinosaur && skin === game.dinosaurStyles[selected];
  return (
    <section className="character-vault" aria-label="공룡 보관소">
      <PageHeading title="DINO VAULT" subtitle="외형만 바뀌며 모든 공룡의 능력치는 같아요." />
      <div className="vault-scroll" tabIndex={0} aria-label="공룡과 외형 선택">
        <header className="roster-heading">
          <strong>보유 공룡</strong>
          <small>공룡을 눌러 미리보기</small>
        </header>
        <div className="vault-roster" aria-label="공룡 선택">
          {dinosaurs.map((item, index) => (
            <button
              key={item.name}
              onClick={() => choose(index)}
              aria-label={`${item.name} 선택`}
              aria-pressed={selected === index}
            >
              <DinosaurArt dinosaur={index} pose="portrait" skin="original" alt="" />
              <span>{item.name}</span>
            </button>
          ))}
        </div>
        <section className="vault-hero cream-card" aria-label="선택한 공룡 미리보기">
          <h3>{dino.name}</h3>
          <p>스킨 · {getSkin(skin).name}</p>
          <div className="vault-hero-stage" data-no-swipe>
            <button aria-label="이전 공룡" onClick={() => choose(selected - 1)}>
              ‹
            </button>
            <div className="character-equipped-preview">
              <DinosaurArt dinosaur={selected} pose="adventure" skin={skin} />
              <EquippedAccessories />
            </div>
            <button aria-label="다음 공룡" onClick={() => choose(selected + 1)}>
              ›
            </button>
          </div>
          <small>
            {selected + 1} / 6 {equipped && "· ✓ 함께하는 공룡"}
          </small>
        </section>
        <div className="vault-tabs shop-tabs" aria-label="외형 분류">
          <button className="shop-tab" aria-pressed={!inventory} onClick={() => setParams({})}>
            스킨
          </button>
          <button
            className="shop-tab"
            aria-pressed={inventory}
            onClick={() => setParams({ tab: "accessories" })}
          >
            악세서리
          </button>
        </div>
        {inventory ? (
          <div className="vault-inventory">
            <AccessoryCatalog inventory />
            <GoldEffects />
          </div>
        ) : (
          <section className="vault-skins" aria-label={`${dino.name} 스킨 선택`}>
            <h3>{dino.name} 스킨 선택</h3>
            <p>스킨은 외형만 변경되며 플레이 성능은 동일해요.</p>
            <div className="vault-skin-grid">
              {skins.map((item) => (
                <button
                  key={item.id}
                  className="style-card"
                  data-equipped={skin === item.id}
                  aria-label={`${dino.name} ${item.name} 스킨 선택`}
                  aria-pressed={skin === item.id}
                  onClick={() => setSkin(item.id)}
                >
                  <span className="style-art" style={{ background: item.surface }}>
                    {selected === 0 && ["desert", "snow", "volcano"].includes(item.id) ? (
                      <img src={`/assets/character/${item.id}.png`} alt="" />
                    ) : (
                      <DinosaurArt dinosaur={selected} pose="withered" skin={item.id} alt="" />
                    )}
                  </span>
                  <strong>{item.name}</strong>
                  {skin === item.id && <span className="skin-check">✓</span>}
                </button>
              ))}
            </div>
            <small>선택한 스킨은 모든 게임 화면에 적용돼요.</small>
          </section>
        )}
        <button
          className="primary-button vault-apply"
          disabled={equipped}
          onClick={() => {
            customizeDinosaur(selected, skin);
            notice(`${dino.name} · ${getSkin(skin).name} 외형을 적용했어요.`);
          }}
        >
          {equipped ? "현재 적용된 외형" : "선택한 외형으로 변경"}
        </button>
      </div>
    </section>
  );
}
