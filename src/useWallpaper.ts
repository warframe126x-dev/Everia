import { useEffect, useState } from "react";
import { readWallpaper } from "./covers";

export function useWallpaper(id?: string) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let disposed = false;
    let objectUrl: string | undefined;
    setUrl(undefined);
    if (id?.startsWith("local-wallpaper:")) {
      readWallpaper(id)
        .then((blob) => {
          if (!blob || disposed) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        })
        .catch(() => undefined);
    }
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return url;
}
