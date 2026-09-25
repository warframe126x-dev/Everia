import { useLocalization } from "./localization/Localization";

export function StarRating({
  rating,
  editable = false,
  onChange,
}: {
  rating?: number;
  editable?: boolean;
  onChange?: (rating?: number) => void;
}) {
  const { t, number } = useLocalization();
  const value = rating ?? 0;
  return (
    <div className={editable ? "star-rating editable" : "star-rating"}>
      <div
        className="stars"
        aria-label={
          rating
            ? t("accessibility.ratingOutOfTen", { rating: number(rating) })
            : t("accessibility.notRated")
        }
      >
        {[0, 1, 2, 3, 4].map((star) => {
          const fill = Math.max(0, Math.min(1, value / 2 - star));
          return (
            <span className="star" key={star}>
              <span className="star-empty" aria-hidden="true">
                ☆
              </span>
              <span
                className="star-fill"
                aria-hidden="true"
                style={{ width: `${fill * 100}%` }}
              >
                ★
              </span>
              {editable && (
                <>
                  <button
                    type="button"
                    aria-label={t("accessibility.rateOutOfTen", {
                      rating: number(star * 2 + 1),
                    })}
                    onClick={() => onChange?.(star * 2 + 1)}
                  />
                  <button
                    type="button"
                    aria-label={t("accessibility.rateOutOfTen", {
                      rating: number(star * 2 + 2),
                    })}
                    onClick={() => onChange?.(star * 2 + 2)}
                  />
                </>
              )}
            </span>
          );
        })}
      </div>
      <strong>
        {rating ? `${number(rating)}/10` : t("accessibility.notRated")}
      </strong>
      {editable && rating && (
        <button
          type="button"
          className="clear-rating"
          onClick={() => onChange?.(undefined)}
        >
          {t("accessibility.clearRating")}
        </button>
      )}
    </div>
  );
}
