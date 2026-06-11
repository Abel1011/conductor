"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL } from "@/lib/api";

export function LiveRefresh() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource(`${API_BASE_URL}/api/events`);

    const scheduleRefresh = () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => router.refresh(), 1200);
    };

    source.onmessage = scheduleRefresh;

    return () => {
      source.close();
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [router]);

  return null;
}
