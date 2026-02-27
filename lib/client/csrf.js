// lib/client/csrf.js
export async function getCsrfToken() {
  const res = await fetch("/api/auth/csrf", {
    method: "GET",
    credentials: "include",
    headers: { "Cache-Control": "no-store" },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok || !data?.csrfToken) {
    throw new Error(data?.error || "Failed to get CSRF token");
  }
  return String(data.csrfToken);
}
