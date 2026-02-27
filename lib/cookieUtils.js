// lib/cookieUtils.js

export function appendSetCookie(res, cookieStr) {
  const prev = res.getHeader("Set-Cookie");

  if (!prev) {
    res.setHeader("Set-Cookie", cookieStr);
    return;
  }

  if (Array.isArray(prev)) {
    res.setHeader("Set-Cookie", [...prev, cookieStr]);
    return;
  }

  // prev is string
  res.setHeader("Set-Cookie", [String(prev), cookieStr]);
}
