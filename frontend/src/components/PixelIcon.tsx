const paths = {
  cloud: "M6 7h3V4h8v3h3v3h3v9H1v-9h5z",
  rain: "M6 5h3V2h8v3h3v3h3v7H1V8h5zM4 17h3v5H4zM11 18h3v6h-3zM18 17h3v5h-3z",
  snow: "M10 1h4v6h3V4h3v3h-3v3h6v4h-6v3h3v3h-3v-3h-3v6h-4v-6H7v3H4v-3h3v-3H1v-4h6V7H4V4h3v3h3z",
  moon: "M9 2h6v3h-3v4h3v3h4v-3h3v7h-3v4h-4v2H8v-2H4v-4H2V8h3V4h4z",
  home: "M2 10h2V8h2V6h2V4h2V2h4v2h2v2h2v2h2v2h2v3h-4v9h-5v-7h-2v7H6v-9H2z",
  character: "M5 2h14v2h3v11h-3v3h-3v4H8v-4H5v-3H2V4h3zM6 6v5h4V6zM14 6v5h4V6zM8 14v2h8v-2z",
  quests: "M4 2h3v20H4zM8 3h13v4h-2v4h2v4H8z",
  camera: "M8 3h8v3h6v15H2V6h6zM9 9v2H7v5h2v2h6v-2h2v-5h-2V9zM10 11h4v5h-4z",
  dashboard: "M2 16h5v6H2zM10 10h5v12h-5zM18 2h5v20h-5z",
  shop: "M8 2h8v2h2v4h4v14H2V8h4V4h2zM9 5v3h6V5zM5 11v8h14v-8z",
  document: "M4 1h12v3h4v19H4zM7 4v16h10V7h-4V4zM8 9h7v2H8zM8 13h7v2H8zM8 17h5v2H8z",
  search:
    "M6 2h10v2h3v3h2v9h-3v3h-3v2H6v-2H3v-3H1V7h2V4h3zM6 6v3H5v5h2v3h7v-2h3V8h-3V6zM18 18h3v3h3v3h-5v-3h-1z",
  menu: "M3 4h18v3H3zM3 11h18v3H3zM3 18h18v3H3z",
  chevron: "M7 2h4v4h4v4h4v4h-4v4h-4v4H7v-4h4v-4h4v-4h-4V6H7z",
  coin: "M7 2h10v2h3v3h2v10h-2v3h-3v2H7v-2H4v-3H2V7h2V4h3zM8 6v12h3V6zM13 6v12h3V6z",
  network:
    "M9 2h6v2h4v3h3v10h-3v3h-4v2H9v-2H5v-3H2V7h3V4h4zM9 5H7v5h3V5zM14 5v5h3V7h-2V5zM5 13v3h2v3h3v-6zM14 13v6h3v-3h2v-3z",
  sun: "M10 1h4v4h-4zM10 19h4v4h-4zM1 10h4v4H1zM19 10h4v4h-4zM7 7h10v10H7zM3 3h3v3H3zM18 3h3v3h-3zM3 18h3v3H3zM18 18h3v3h-3z",
} as const;
export type PixelIconName = keyof typeof paths;
export function PixelIcon({ name, className = "" }: { name: PixelIconName; className?: string }) {
  return (
    <svg
      className={`pixel-icon ${className}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path fill="currentColor" fillRule="evenodd" d={paths[name]} />
    </svg>
  );
}
