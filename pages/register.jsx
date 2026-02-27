import { useEffect, useMemo, useState } from "react";
import Nav from "../components/Nav";
import { useLanguage } from "../context/LanguageContext";
import translations from "../translations";

function isEmail(s) {
  const v = String(s || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function msToClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// ---------- Password policy (UI) ----------
const PASS_MIN = 8;

function passRules(pw) {
  const s = String(pw || "");
  const rules = {
    minLen: s.length >= PASS_MIN,
    lower: /[a-z]/.test(s),
    upper: /[A-Z]/.test(s),
    digit: /\d/.test(s),
    symbol: /[^A-Za-z0-9]/.test(s), // ✅ NEW
  };

  const okCount = Object.values(rules).filter(Boolean).length;
  const total = Object.keys(rules).length;

  const label =
    okCount <= 2 ? "Weak" : okCount === 3 ? "Fair" : okCount === 4 ? "Good" : "Strong";

  return { rules, okCount, total, label };
}

function passHintText(info) {
  const { rules } = info || {};
  const missing = [];
  if (!rules?.minLen) missing.push(`at least ${PASS_MIN} characters`);
  if (!rules?.lower) missing.push("a lowercase letter (a-z)");
  if (!rules?.upper) missing.push("an uppercase letter (A-Z)");
  if (!rules?.digit) missing.push("a number (0-9)");
  if (!rules?.symbol) missing.push("a symbol (!@#$...)");
  if (missing.length === 0) return "Strong password ✅";
  return `Use ${missing.join(", ")}.`;
}
export default function Register() {
  const { lang, dir } = useLanguage();

  useMemo(() => {
    const base = translations.en || {};
    const current = translations[lang] || base;
    return { ...base, ...current };
  }, [lang]);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    birthDate: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  // ✅ فقط UI: show/hide
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [step, setStep] = useState(1); // 1=form, 2=otp, 3=done
  const [loading, setLoading] = useState(false);

  const [otpToken, setOtpToken] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [expiresAt, setExpiresAt] = useState(null);

  const [remainingMs, setRemainingMs] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ✅ Password live strength (UI)
  const passInfo = useMemo(() => passRules(form.password), [form.password]);
  const passHint = useMemo(() => passHintText(passInfo), [passInfo]);
  const passMatch =
    String(form.password || "") &&
    String(form.confirmPassword || "") &&
    String(form.password) === String(form.confirmPassword);

  function update(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  function validateForm() {
    if (
      !form.firstName ||
      !form.lastName ||
      !form.birthDate ||
      !form.phone ||
      !form.email ||
      !form.password ||
      !form.confirmPassword
    )
      return "Please fill in all fields.";

    if (!isEmail(form.email)) return "Please enter a valid email address.";

    const p = passRules(form.password);
    if (!p.rules.minLen) return `Password must be at least ${PASS_MIN} characters.`;
    if (!p.rules.lower) return "Password must include at least one lowercase letter (a-z).";
    if (!p.rules.upper) return "Password must include at least one uppercase letter (A-Z).";
    if (!p.rules.digit) return "Password must include at least one number (0-9).";
    if (!p.rules.symbol) return "Password must include at least one symbol (!@#$...).";

    if (form.password !== form.confirmPassword) return "Passwords do not match.";

    return "";
  }

  async function requestOtpCore() {
    const res = await fetch("/api/auth/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.email }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || "Failed to send verification code.");
    }

    setOtpToken(data.token);
    setExpiresAt(data.expiresAt || null);
    setStep(2);
    setOtpCode("");
    setSuccess("✅ Verification code sent to your email. Please check your inbox/spam.");
  }

  async function requestOtp(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const v = validateForm();
    if (v) {
      setError(v);
      return;
    }

    setLoading(true);
    try {
      await requestOtpCore();
    } catch (err) {
      setError(err?.message || "Server error");
    } finally {
      setLoading(false);
    }
  }

  function saveCurrentUserToLocalStorage(user) {
    // صرفاً برای UI — امنیت واقعی باید session/cookie باشد
    localStorage.setItem(
      "regorixa_current_user",
      JSON.stringify({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        birthDate: user.birthDate,
        phone: user.phone,
        email: user.email,
        createdAt: user.createdAt,
        emailVerified: true,
        role: user.role,
      })
    );
  }

  async function verifyOtp(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const code = String(otpCode || "").trim();
    if (code.length !== 6) {
      setError("Please enter the 6-digit code.");
      return;
    }

    if (expiresAt && Date.now() > new Date(expiresAt).getTime()) {
      setError("Code expired. Please resend a new code.");
      return;
    }

    setLoading(true);
    try {
      // 1) verify otp
      const res1 = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: otpToken, code }),
      });

      const data1 = await res1.json().catch(() => ({}));
      if (!res1.ok || !data1?.ok) {
        throw new Error(data1?.error || "Invalid code.");
      }

      // 2) register user on server (real registration)
      const res2 = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          birthDate: form.birthDate,
          phone: form.phone,
          email: form.email,
          password: form.password,
        }),
      });

      const data2 = await res2.json().catch(() => ({}));
      if (!res2.ok || !data2?.ok) {
        throw new Error(data2?.error || "Registration failed.");
      }

      if (!data2?.user?.email) throw new Error("Invalid server response.");

      saveCurrentUserToLocalStorage(data2.user);

      setSuccess("✅ Email verified. Registration completed. You are now logged in.");
      setStep(3);
    } catch (err) {
      setError(err?.message || "Server error");
    } finally {
      setLoading(false);
    }
  }

  async function resendOtp() {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      await requestOtpCore();
      setSuccess("✅ New code sent. Please check your email.");
    } catch (err) {
      setError(err?.message || "Failed to resend code.");
    } finally {
      setLoading(false);
    }
  }

  function backToForm() {
    setError("");
    setSuccess("");
    setStep(1);
    setOtpCode("");
    setOtpToken("");
    setExpiresAt(null);
    setRemainingMs(0);
  }

  useEffect(() => {
    if (step !== 2 || !expiresAt) return;

    const tick = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setRemainingMs(ms);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [step, expiresAt]);

  const expired = step === 2 && expiresAt ? Date.now() > new Date(expiresAt).getTime() : false;
  return (
    <div
      className="container"
      dir={dir}
      style={{ textAlign: dir === "rtl" ? "right" : "left" }}
    >
      <Nav />

      <div className="glass section authBox">
        <h1>Create Account</h1>
        <p className="muted">Register to access REGORIXA plans</p>

        {step === 1 && (
          <form onSubmit={requestOtp} className="authForm">
            <input
              name="firstName"
              placeholder="First Name"
              onChange={update}
              value={form.firstName}
            />
            <input
              name="lastName"
              placeholder="Last Name"
              onChange={update}
              value={form.lastName}
            />
            <input type="date" name="birthDate" onChange={update} value={form.birthDate} />
            <input
              name="phone"
              placeholder="Mobile Number"
              onChange={update}
              value={form.phone}
            />
            <input
              type="email"
              name="email"
              placeholder="Email Address"
              onChange={update}
              value={form.email}
            />

            {/* ✅ Password + Show/Hide */}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                style={{ flex: 1 }}
                type={showPass ? "text" : "password"}
                name="password"
                placeholder="Password"
                onChange={update}
                value={form.password}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="btnGhost"
                onClick={() => setShowPass((v) => !v)}
                style={{ minWidth: 90 }}
                aria-label={showPass ? "Hide password" : "Show password"}
              >
                {showPass ? "Hide" : "Show"}
              </button>
            </div>

            {/* ✅ Password strength + rules */}
            <div
              style={{
                marginTop: 8,
                padding: "10px 12px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div className="muted" style={{ fontSize: 13 }}>
                  Password strength: <b style={{ opacity: 0.95 }}>{passInfo.label}</b>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {passInfo.okCount}/{passInfo.total}
                </div>
              </div>

              <div
                style={{
                  height: 8,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.10)",
                  overflow: "hidden",
                  marginTop: 8,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.round((passInfo.okCount / passInfo.total) * 100)}%`,
                    background: "rgba(255,255,255,0.65)",
                    transition: "width 180ms ease",
                  }}
                />
              </div>

              <ul style={{ margin: "10px 0 0", paddingInlineStart: 18, fontSize: 13 }}>
                <li style={{ opacity: passInfo.rules.minLen ? 1 : 0.6 }}>
                  {passInfo.rules.minLen ? "✅" : "⬜"} At least {PASS_MIN} characters
                </li>
                <li style={{ opacity: passInfo.rules.lower ? 1 : 0.6 }}>
                  {passInfo.rules.lower ? "✅" : "⬜"} Lowercase letter (a-z)
                </li>
                <li style={{ opacity: passInfo.rules.upper ? 1 : 0.6 }}>
                  {passInfo.rules.upper ? "✅" : "⬜"} Uppercase letter (A-Z)
                </li>
                <li style={{ opacity: passInfo.rules.digit ? 1 : 0.6 }}>
                  {passInfo.rules.digit ? "✅" : "⬜"} Number (0-9)
                </li>
                <li style={{ opacity: passInfo.rules.symbol ? 1 : 0.6 }}>
                  {passInfo.rules.symbol ? "✅" : "⬜"} Symbol (!@#$...)
                </li>
              </ul>

              {passHint ? (
                <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                  Tip: {passHint}
                </div>
              ) : null}
            </div>

            {/* ✅ Confirm Password + Show/Hide */}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                style={{ flex: 1 }}
                type={showConfirm ? "text" : "password"}
                name="confirmPassword"
                placeholder="Confirm Password"
                onChange={update}
                value={form.confirmPassword}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="btnGhost"
                onClick={() => setShowConfirm((v) => !v)}
                style={{ minWidth: 90 }}
                aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"}
              >
                {showConfirm ? "Hide" : "Show"}
              </button>
            </div>

            {String(form.confirmPassword || "").length > 0 ? (
              <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                Confirm: <b>{passMatch ? "Match ✅" : "Not match ⚠️"}</b>
              </div>
            ) : null}

            {error && <div className="errorBox">{error}</div>}
            {success && <div className="success">{success}</div>}

            <button className="btnPrimary" disabled={loading}>
              {loading ? "Sending code..." : "Register"}
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={verifyOtp} className="authForm">
            <div className="muted" style={{ fontSize: 13 }}>
              We sent a verification code to <b>{form.email}</b>.{" "}
              {expiresAt ? (
                <>
                  Code expires in: <b>{msToClock(remainingMs)}</b>
                </>
              ) : null}
              {expired ? (
                <div style={{ marginTop: 6 }}>
                  <b>Code expired.</b> Please resend.
                </div>
              ) : null}
            </div>

            <input
              inputMode="numeric"
              placeholder="Enter 6-digit code"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />

            {error && <div className="errorBox">{error}</div>}
            {success && <div className="success">{success}</div>}

            <button className="btnPrimary" disabled={loading || expired}>
              {loading ? "Verifying..." : "Verify Email"}
            </button>

            <button
              type="button"
              className="btnGhost"
              onClick={resendOtp}
              disabled={loading}
              style={{ marginTop: 10 }}
            >
              Resend code
            </button>

            <button
              type="button"
              className="btnGhost"
              onClick={backToForm}
              disabled={loading}
              style={{ marginTop: 10 }}
            >
              Back
            </button>
          </form>
        )}

        {step === 3 && (
          <div style={{ marginTop: 14 }}>
            {success && <div className="success">{success}</div>}
            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <a className="btnPrimary" href="/dashboard">
                Go to Dashboard
              </a>
              <a className="btnGhost" href="/login">
                Go to Login
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
