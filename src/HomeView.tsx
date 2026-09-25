import {
  BookOpen,
  Clapperboard,
  Film,
  Gamepad2,
  Library,
  MonitorPlay,
  Settings,
} from "lucide-react";
import { categoryInfo, categoryLabel } from "./data";
import { assetUrl } from "./assetPaths";
import { categoryArtworkUrl } from "./categoryAssets";

import { categories, type Category, type MediaItem } from "./types";
import { useLocalization } from "./localization/Localization";

const categoryIcons: Record<Category, typeof BookOpen> = {
  games: Gamepad2,
  movies: Clapperboard,
  "tv-series": MonitorPlay,
  novels: BookOpen,
  manga: Library,
  anime: Film,
};

export function HomeView({
  items,
  onOpen,
  onSettings,
}: {
  items: MediaItem[];
  onOpen: (category: Category) => void;
  onSettings: () => void;
}) {
  const { locale, t, count: formatCount } = useLocalization();
  return (
    <div className="home-page">
      <div className="home-atmosphere" aria-hidden="true" />
      <section className="home-content">
        <div className="home-intro">
          <span className="brand-symbol">
            <img src={assetUrl("assets/branding/everia-ui-mark.png")} alt="" />
          </span>
          <div>
            <h1>EVERIA</h1>
            <p>{t("home.tagline")}</p>
          </div>
        </div>
        <div className="category-grid">
          {categories.map((category) => {
            const Icon = categoryIcons[category];
            const info = categoryInfo[category];
            const count = items.filter((x) => x.category === category).length;
            return (
              <button
                className={`category-card category-${category}`}
                key={category}
                style={
                  {
                    "--category": info.hue,
                    "--category-art": `url("${categoryArtworkUrl(category)}")`,
                  } as React.CSSProperties
                }
                onClick={() => onOpen(category)}
              >
                <span className="card-icon">
                  <Icon />
                </span>
                <strong>{categoryLabel(category, locale)}</strong>
                <small>{formatCount("home.entryCount", count)}</small>
              </button>
            );
          })}
        </div>
        <footer className="home-footer">
          <em>{t("home.footer")}</em>
          <button aria-label={t("navigation.settings")} onClick={onSettings}>
            <Settings />
          </button>
        </footer>
      </section>
    </div>
  );
}
