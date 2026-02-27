// lib/ipUa.js
export function getIp(req) {
  try {
    const xf = req?.headers?.["x-forwarded-for"];
    const ipFromXf = Array.isArray(xf)
      ? xf[0]
      : String(xf || "").split(",")[0].trim();

    return (
      ipFromXf ||
      req?.headers?.["x-real-ip"] ||
      req?.socket?.remoteAddress ||
      "unknown"
    ).toString();
  } catch {
    return "unknown";
  }
}

export function getUa(req) {
  try {
    const ua = req?.headers?.["user-agent"];
    if (Array.isArray(ua)) return ua[0] || "";
    return String(ua || "");
  } catch {
    return "";
  }
}
