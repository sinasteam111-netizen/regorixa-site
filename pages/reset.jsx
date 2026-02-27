import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Nav from "../components/Nav";

const RESEND_COOLDOWN_SEC = 60; // مدت زمان قفل بودن دکمه Resend

export default function Reset() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState("");

  // Resend state
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMsg, setResendMsg] = useState("");
  const [cooldownLeft, setCooldownLeft] = useState(0); // seconds left

  // ✅ ایمیل از query
  const emailFromQuery = useMemo(() => {
    const q = router.query?.email;
    if (!q) return "";
    return String(q).trim().toLowerCase();
  }, [router.query?.email]);

  // ✅ وقتی query اومد، ایمیل رو ست کن
  useEffect(() => {
    if (emailFromQuery) setEmail(emailFromQuery);
  }, [emailFromQuery]);

  const emailLocked = !!emailFromQuery;

  // ----- Cooldown helpers (persisted) -----
  const cooldownKey = useMemo(() => {
    const e = String(email || "").trim().toLowerCase();
    return e ? `reset_resend_until_${e}` : "";
  }, [email]);

  function startCooldown(seconds = RESEND_COOLDOWN_SEC) {
    const until = Date.now() + seconds * 1000;
    if (cooldownKey) localStorage.setItem(cooldownKey, String(until));
    setCooldownLeft(seconds);
  }

  // Load cooldown from localStorage on email change
  useEffect(() => {
    if (!cooldownKey) return;

    const raw = localStorage.getItem(cooldownKey);
    const until = raw ? Number(raw) : 0;
    const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    setCooldownLeft(left);
  }, [cooldownKey]);

  // Countdown tick
  useEffect(() => {
    if (cooldownLeft <= 0) return;

    const t = setInterval(() => {
      setCooldownLeft((s) => Math.max(0, s - 1));
    }, 1000);

    return () => clearInterval(t);
  }, [cooldownLeft]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const cleanedEmail = String(email || "").trim().toLowerCase();
    const cleanedOtp = String(otp || "").trim();

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: cleanedEmail,
          otp: cleanedOtp,
          newPassword,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Failed to reset password.");
        return;
      }

      setOk(true);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  async function resendCode() {
    const cleanedEmail = String(email || "").trim().toLowerCase();
    if (!cleanedEmail) {
      setResendMsg("Please enter your email first.");
      return;
    }
    if (cooldownLeft > 0) return;

    setResendMsg("");
    setResendLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/request-reset-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanedEmail }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        setResendMsg(data?.error || "Could not resend code. Try again.");
        return;
      }

      setResendMsg("✅ Code resent. Check your email.");
      startCooldown(RESEND_COOLDOWN_SEC);
    } catch {
      setResendMsg("Network error while resending.");
    } finally {
      setResendLoading(false);
    }
  }

  return (
    <div className="container">
      <Nav />

      <div className="glass section authBox">
        <h1>Reset Password</h1>
        <p className="muted">Enter the code + set a new password</p>

        {ok ? (
          <div className="success">
            ✅ Password updated successfully. <a href="/login">Go to login</a>
          </div>
        ) : (
          <form onSubmit={submit} className="authForm">
            <input
              type="email"
              placeholder="Email"
              value={email}
              autoComplete="email"
              readOnly={emailLocked}
              onChange={(e) => setEmail(e.target.value)}
              style={emailLocked ? { opacity: 0.9, cursor: "not-allowed" } : undefined}
            />

            <input
              inputMode="numeric"
              placeholder="6-digit code"
              value={otp}
              onChange={(e) =>
                setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
            />

            {/* Password + Show/Hide */}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                style={{ flex: 1 }}
                type={showPass ? "text" : "password"}
                placeholder="New password (min 8 chars)"
                value={newPassword}
                autoComplete="new-password"
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <button
                type="button"
                className="btnGhost"
                onClick={() => setShowPass((v) => !v)}
                style={{ minWidth: 90 }}
              >
                {showPass ? "Hide" : "Show"}
              </button>
            </div>

            {error ? <div className="errorBox">{error}</div> : null}

            <button className="btnPrimary" disabled={loading}>
              {loading ? "Saving..." : "Reset password"}
            </button>

            {/* ✅ Resend code with cooldown */}
            <button
              type="button"
              className="btnGhost"
              onClick={resendCode}
              disabled={resendLoading || cooldownLeft > 0}
              style={{ marginTop: 10 }}
            >
              {resendLoading
                ? "Resending..."
                : cooldownLeft > 0
                ? `Resend in ${cooldownLeft}s`
                : "Resend code"}
            </button>

            {resendMsg ? <div className="success" style={{ marginTop: 10 }}>{resendMsg}</div> : null}
          </form>
        )}
      </div>
    </div>
  );
}

