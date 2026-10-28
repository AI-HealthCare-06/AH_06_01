// Reference prices read from live public Coupang product pages on 2026-10-27.
// These are dated examples, not a real-time feed or an offer to fulfil orders.
export const retailPricePolicy = {
  merchant: "쿠팡",
  wonPerRp: 1,
  percentOfReference: 90,
  checkedOn: "2026-10-27",
  sourceKind: "public-page-snapshot",
} as const;
export const discountedRetailRp = (referenceWon: number) =>
  Number.isSafeInteger(referenceWon) && referenceWon > 0
    ? Math.floor((referenceWon * 90) / 100)
    : 0;
export const retailReferences = [
  {
    product: "하림 닭가슴살 5종 각 2봉",
    pack: "100g × 10봉",
    referenceWon: 24300,
    sourceUrl:
      "https://www.coupang.com/vp/products/9715365887?itemId=29070550353&vendorItemId=95996737384",
    sourceAge: "일반 판매가 확인 · 배송비 별도 기준",
  },
  {
    product: "정관장 홍삼원력",
    pack: "50ml × 30포",
    referenceWon: 26780,
    sourceUrl:
      "https://www.coupang.com/vp/products/8289126732?itemId=16434785929&vendorItemId=95625464526",
    sourceAge: "일반 판매가 확인 · 배송비 별도 기준",
  },
  {
    product: "종근당건강 원데이21",
    pack: "60정 × 1개",
    referenceWon: 11500,
    sourceUrl: "https://www.coupang.com/vp/products/7735337888",
    sourceAge: "60정 1개 옵션 · 회원/카드 할인 제외",
  },
  {
    product: "셀렉스 프로틴 오리지널",
    pack: "190ml × 24개",
    referenceWon: 27900,
    sourceUrl:
      "https://www.coupang.com/vp/products/9334640009?itemId=19428960882&vendorItemId=82914630148",
    sourceAge: "일반 판매가 확인 · 배송비 별도 기준",
  },
  {
    product: "이든타운 유기농 오트밀 퀵롤드오츠",
    pack: "1kg × 1개",
    referenceWon: 7500,
    sourceUrl:
      "https://www.coupang.com/vp/products/1805422452?itemId=3071951283&vendorItemId=71059864738",
    sourceAge: "일반 판매가 확인 · 배송비 별도 기준",
  },
  {
    product: "곰곰 고소한 구운 아몬드",
    pack: "400g × 1개",
    referenceWon: 10100,
    sourceUrl:
      "https://www.coupang.com/vp/products/170868917?itemId=488782746&vendorItemId=4235125582",
    sourceAge: "일반 판매가 확인 · 확인 당시 품절",
  },
] as const;
