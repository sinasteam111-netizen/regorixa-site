import { useEffect, useState } from "react";
import Nav from "../components/Nav";
import { useRouter } from "next/router";
import { getCsrfToken } from "../lib/client/csrf";

export default function Login() {
  const router = useRouter();

  // Step: "password" | "2fa"
  const [step, setStep] = useState("password");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  const [twoFaCode, setTwoFaCode] = useState("");
  const [pending2faToken, setPending2faToken] = useState("");

  // ✅ allow backup codes too
  const [useBackupCode, setUseBackupCode] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ✅ show note if user used backup code
  const [note, setNote] = useState("");

  // ✅ CSRF token (double submit)
  const [csrfToken, setCsrfToken] = useState("");

  useEffect(() => {
    let alive = true;

    // best-effort: اگر به هر دلیل نشد، پیام نمی‌زنیم تا UX نشکنه
    // ولی submitها اگر csrfToken نداشته باشند، خطا خواهند خورد (طبق سرور)
    getCsrfToken()
      .then((t) => {
        if (!alive) return;
        setCsrfToken(String(t || ""));
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, []);

  async function submitPassword(e) {
    e.preventDefault();
    setError("");
    setNote("");

    const emailNorm = String(email || "").trim().toLowerCase();
    if (!emailNorm || !password) {
      setError("Please enter email and password.");
      return;
    }

    if (!csrfToken) {
      setError("Security token not ready. Please refresh the page and try again.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "include", // ✅ مهم: ست شدن cookie سشن
        body: JSON.stringify({ email: emailNorm, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        setError(data?.error || "Invalid email or password.");
        return;
      }

      // ✅ اگر 2FA لازم است: برو مرحله دوم
      if (data?.twoFactorRequired) {
        setPending2faToken(String(data.pending2faToken || ""));
        setStep("2fa");
        setTwoFaCode("");
        setUseBackupCode(false);
        return;
      }

      // ✅ ورود عادی (بدون 2FA): سشن ساخته شده
      try {
        localStorage.setItem(
          "regorixa_current_user",
          JSON.stringify({
            email: data.user?.email || emailNorm,
            role: data.user?.role || "user",
          })
        );
      } catch {}

      router.push("/dashboard");
    } catch {
      setError("Server error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function submit2fa(e) {
    e.preventDefault();
    setError("");
    setNote("");

    const emailNorm = String(email || "").trim().toLowerCase();
    const codeRaw = String(twoFaCode || "").trim();

    if (!pending2faToken) {
      setError("2FA session expired. Please login again.");
      setStep("password");
      return;
    }

    if (!csrfToken) {
      setError("Security token not ready. Please refresh the page and try again.");
      return;
    }

    if (!useBackupCode) {
      if (codeRaw.length !== 6 || !/^\d{6}$/.test(codeRaw)) {
        setError("Please enter the 6-digit code.");
        return;
      }
    } else {
      const norm = codeRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (norm.length < 8) {
        setError("Please enter a valid backup code.");
        return;
      }
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/complete-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "include", // ✅ مهم: ست شدن cookie سشن
        body: JSON.stringify({
          pending2faToken,
          token: codeRaw,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        setError(data?.error || "Invalid authentication code.");
        return;
      }

      // ✅ الان سشن ساخته شده، این localStorage فقط برای UI
      try {
        localStorage.setItem(
          "regorixa_current_user",
          JSON.stringify({
            email: emailNorm,
            role: "user",
          })
        );
      } catch {}

      // ✅ اگر با Backup Code وارد شده: پیام + ذخیره برای داشبورد
      if (data?.method === "recovery") {
        const rem =
          Number.isFinite(data?.recoveryCodesRemaining) ? data.recoveryCodesRemaining : null;

        const msg =
          rem !== null
            ? `✅ Signed in using a backup code. Remaining backup codes: ${rem}.`
            : "✅ Signed in using a backup code. Consider generating new backup codes in Security.";

        setNote(msg);
        try {
          localStorage.setItem("regorixa_backup_note", msg);
        } catch {}
      } else {
        try {
          localStorage.removeItem("regorixa_backup_note");
        } catch {}
      }

      router.push("/dashboard");
    } catch {
      setError("Server error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function backToPassword() {
    setError("");
    setNote("");
    setStep("password");
    setPending2faToken("");
    setTwoFaCode("");
    setUseBackupCode(false);
    // password رو نگه می‌داریم تا کاربر راحت‌تر باشه
  }

  return (
    <div className="container">
      <Nav />

      <div className="glass section authBox">
        <h1>Login</h1>
        <p className="muted">Access your REGORIXA account</p>

        {step === "password" ? (
          <form onSubmit={submitPassword} className="authForm">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                style={{ flex: 1 }}
                type={showPass ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
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

            <div style={{ marginTop: 8 }}>
              <a className="muted" href="/forgot" style={{ fontSize: 12 }}>
                Forgot password?
              </a>
            </div>

            {error && <div className="errorBox">{error}</div>}

            <button className="btnPrimary" disabled={loading}>
              {loading ? "Logging in..." : "Login"}
            </button>
          </form>
        ) : (
          <form onSubmit={submit2fa} className="authForm">
            <div className="muted" style={{ fontSize: 12 }}>
              Two-factor authentication is enabled for:
            </div>
            <div style={{ marginBottom: 10, fontWeight: 700 }}>
              {String(email || "").trim().toLowerCase()}
            </div>

            <input
              inputMode={useBackupCode ? "text" : "numeric"}
              placeholder={useBackupCode ? "Backup code (e.g. 0D17-5211)" : "6-digit code"}
              value={twoFaCode}
              onChange={(e) => {
                const v = e.target.value;
                if (useBackupCode) {
                  setTwoFaCode(v.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20));
                } else {
                  setTwoFaCode(v.replace(/\D/g, "").slice(0, 6));
                }
              }}
            />

            <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btnGhost"
                onClick={() => {
                  setUseBackupCode((x) => !x);
                  setTwoFaCode("");
                  setError("");
                  setNote("");
                }}
                disabled={loading}
              >
                {useBackupCode ? "Use Authenticator code" : "Use a backup code"}
              </button>

              <div className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
                {useBackupCode
                  ? "Enter one of your backup codes."
                  : "Enter the 6-digit code from your app."}
              </div>
            </div>

            {note ? (
              <div className="success" style={{ marginTop: 10 }}>
                {note}
              </div>
            ) : null}

            {error && <div className="errorBox">{error}</div>}

            <button className="btnPrimary" disabled={loading}>
              {loading ? "Verifying..." : "Verify & login"}
            </button>

            <button
              type="button"
              className="btnGhost"
              onClick={backToPassword}
              disabled={loading}
              style={{ marginTop: 10 }}
            >
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
