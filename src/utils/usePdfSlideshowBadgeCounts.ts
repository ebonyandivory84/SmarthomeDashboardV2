import { useEffect, useState } from "react";
import { IoBrokerClient } from "../services/iobroker";
import { DashboardPage, PdfSlideshowWidgetConfig } from "../types/dashboard";

const POLL_INTERVAL_MS = 60_000;

export function usePdfSlideshowBadgeCounts(dashboardPages: DashboardPage[], client: IoBrokerClient) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const nextCounts: Record<string, number> = {};
      for (const page of dashboardPages) {
        const pdfWidgets = page.widgets.filter(
          (widget): widget is PdfSlideshowWidgetConfig => widget.type === "pdfSlideshow",
        );
        if (!pdfWidgets.length) {
          continue;
        }
        let total = 0;
        for (const widget of pdfWidgets) {
          try {
            const files = await client.listWebdavPdfFiles(widget);
            total += files.length;
          } catch {
            // Ordner nicht erreichbar - Zaehlung fuer dieses Widget ueberspringen.
          }
        }
        nextCounts[page.id] = total;
      }
      if (!cancelled) {
        setCounts(nextCounts);
      }
    };

    void poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, dashboardPages]);

  return counts;
}
