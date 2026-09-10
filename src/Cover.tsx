import { useEffect, useState } from "react";
import { BookOpen, Heart } from "lucide-react";
import { readCover } from "./covers";
import type { MediaItem } from "./types";

export function Cover({
  item,
  detail = false,
}: {
  item: MediaItem;
  detail?: boolean;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let disposed = false;
    let objectUrl: string | undefined;
    setUrl(undefined);
    if (item.coverUrl?.startsWith("local-cover:")) {
      readCover(item.coverUrl)
        .then((blob) => {
          if (disposed || !blob) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        })
        .catch(() => {
          /* Keep an offline placeholder when a local asset is unavailable. */
        });
    }
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.coverUrl]);
  return (
    <div className={detail ? "detail-cover cover" : "cover"}>
      {url ? (
        <img
          src={url}
          alt={`Cover of ${item.title}`}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            position: "absolute",
          }}
        />
      ) : (
        <>
          <span>{item.title.slice(0, 1)}</span>
          <BookOpen />
        </>
      )}
      {item.favorite && (
        <Heart className="favorite-badge" fill="currentColor" />
      )}
    </div>
  );
}
