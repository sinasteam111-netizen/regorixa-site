export function getCurrentUser() {
  try {
    const raw = localStorage.getItem("regorixa_current_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function requireAuth(router) {
  const user = getCurrentUser();
  if (!user) {
    router.replace("/login");
    return null;
  }
  return user;
}

export function logout(router) {
  try {
    localStorage.removeItem("regorixa_current_user");
  } catch {}
  router.push("/login");
}
