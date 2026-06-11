import { API_BASE_URL } from "@/lib/api";

export async function POST() {
  const secret = process.env.INTERNAL_TRIGGER_SECRET || "";

  const response = await fetch(`${API_BASE_URL}/internal/run-mission`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": secret,
    },
    body: JSON.stringify({}),
    cache: "no-store",
  });

  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}
