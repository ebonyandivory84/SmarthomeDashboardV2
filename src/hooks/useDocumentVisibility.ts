import { useEffect, useState } from "react";
import { Platform } from "react-native";

export function useDocumentVisibility() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") {
      return;
    }

    const update = () => {
      setVisible(!document.hidden);
    };

    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return visible;
}
