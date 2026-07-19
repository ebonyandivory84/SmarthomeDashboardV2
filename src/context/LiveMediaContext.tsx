import { PropsWithChildren, createContext, useCallback, useContext, useMemo, useState } from "react";

type LiveMediaContextValue = {
  activeMediaId: string | null;
  activateMedia: (mediaId: string) => void;
  releaseMedia: (mediaId: string) => void;
};

const LiveMediaContext = createContext<LiveMediaContextValue | null>(null);

export function LiveMediaProvider({ children }: PropsWithChildren) {
  const [activeMediaId, setActiveMediaId] = useState<string | null>(null);
  const activateMedia = useCallback((mediaId: string) => setActiveMediaId(mediaId), []);
  const releaseMedia = useCallback((mediaId: string) => {
    setActiveMediaId((current) => (current === mediaId ? null : current));
  }, []);
  const value = useMemo(
    () => ({ activeMediaId, activateMedia, releaseMedia }),
    [activeMediaId, activateMedia, releaseMedia]
  );

  return <LiveMediaContext.Provider value={value}>{children}</LiveMediaContext.Provider>;
}

export function useLiveMedia() {
  const value = useContext(LiveMediaContext);
  if (!value) {
    throw new Error("useLiveMedia must be used inside LiveMediaProvider");
  }
  return value;
}
