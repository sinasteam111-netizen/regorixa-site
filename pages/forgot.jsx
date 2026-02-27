import { useState } from "react";
import { useRouter } from "next/router";
import Nav from "../components/Nav";

export default function Forgot() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit(e) {
    e.preventDefault();
    setMsg("");
    setLoading(true);

    const cleanedEmail = String(email || "").trim().toLowerCase();

    try {
      const res = await fetch("/api/auth/request-reset-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanedEmail }),
      });

      const data = await res.json().catch(() => ({}));

      // اگر API ok برگردوند، برو reset و ایمیل رو پاس بده
      if (res.ok && data?.ok) {
        setMsg("Code sent. Redirecting to reset...");
        router.push(`/reset?email=${encodeURIComponent(cleanedEmail)}`);
        return;
      }

      // اگر ok نبود، پیام خطا رو نشون بده ولی همچنان پیام امن هم می‌تونی نمایش بدی
      setMsg(data?.error || data?.message || "Something went wrong. Please try again.");
    } catch {
      setMsg("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <Nav />

      <div className="glass section authBox">
        <h1>Forgot Password</h1>
        <p className="muted">Receive a reset code via email</p>

        <form onSubmit={submit} className="authForm">
          <input
            type="email"
            placeholder="Email"
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />

          {msg ? (
            <div className="success">
              {msg}{" "}
              {/* لینک دستی هم می‌ذاریم؛ با ایمیل */}
              <a href={`/reset?email=${encodeURIComponent(String(email || "").trim().toLowerCase())}`}>
                Go to reset
              </a>
            </div>
          ) : null}

          <button className="btnPrimary" disabled={loading}>
            {loading ? "Sending..." : "Send code"}
          </button>

          <a className="btnGhost" href="/login" style={{ marginTop: 10 }}>
            Back to login
          </a>
        </form>
      </div>
    </div>
  );
}
