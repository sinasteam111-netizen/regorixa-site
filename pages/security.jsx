import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Nav from "../components/Nav";
import { useLanguage } from "../context/LanguageContext";

import ar from "../translations/ar";
import en from "../translations/en";

export default function Security() {
  const router = useRouter();
  const { lang } = useLanguage();
  const t = lang === "ar" ? ar : en;

  const [user, setUser] = useState(null);

  // Change password
  const [curPass, setCurPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [loadingPass, setLoadingPass] = useState(false);
  const [passMsg, setPassMsg] = useState("");
  const [passErr, setPassErr] = useState("");

  // ✅ show/hide password (UI only) — (برای جلوگیری از ReferenceError)
  const [showCurPass, setShowCurPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);

  // 2FA
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [qr, setQr] = useState("");
  const [manualKey, setManualKey] = useState("");
  const [copied, setCopied] = useState(false);

  const [token, setToken] = useState("");
  const [loading2fa, setLoading2fa] = useState(false);
  const [faMsg, setFaMsg] = useState("");
  const [faErr, setFaErr] = useState("");

  // UI state
  const [showSetup, setShowSetup] = useState(false);
  const [showDisableBox, setShowDisableBox] = useState(false);

  // ✅ Security log
  const [loginLog, setLoginLog] = useState([]);

  // ✅ Backup codes (UI)
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [loadingRecovery, setLoadingRecovery] = useState(false);
  const [recoveryMsg, setRecoveryMsg] = useState("");
  const [recoveryErr, setRecoveryErr] = useState("");

  // ✅ counters from /api/auth/me  (Option 1)
  const [recoveryTotal, setRecoveryTotal] = useState(null);
  const [recoveryRemaining, setRecoveryRemaining] = useState(null);

  // ✅ regenerate box + OTP (Option 2)
  const [showRecoveryBox, setShowRecoveryBox] = useState(false);
  const [recoveryOtp, setRecoveryOtp] = useState("");

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data?.ok || !data?.user?.email) {
          router.replace("/login");
          return;
        }
        if (!mounted) return;

        setUser(data.user);
        setTwoFaEnabled(!!data.user?.twoFactorEnabled);

        setRecoveryTotal(
          Number.isFinite(data.user?.recoveryCodesTotal)
            ? data.user.recoveryCodesTotal
            : 0
        );
        setRecoveryRemaining(
          Number.isFinite(data.user?.recoveryCodesRemaining)
            ? data.user.recoveryCodesRemaining
            : 0
        );

        // ✅ fetch security logs
        try {
          const lr = await fetch(
            `/api/security/logins?email=${encodeURIComponent(data.user.email)}`,
            { credentials: "include" }
          );
          const ld = await lr.json().catch(() => ({}));
          if (mounted && lr.ok && ld?.ok) {
            setLoginLog(Array.isArray(ld.log) ? ld.log : []);
          }
        } catch {}
      } catch {
        router.replace("/login");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  async function changePassword(e) {
    e.preventDefault();
    setPassMsg("");
    setPassErr("");
    setLoadingPass(true);

    try {
      const res = await fetch("/api/security/2fa/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: user.email,
          currentPassword: curPass,
          newPassword: newPass,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        setPassErr(data?.error || t.security.passFailed);
        return;
      }

      setPassMsg(t.security.passChanged);
      setCurPass("");
      setNewPass("");
    } catch {
      setPassErr(t.security.networkError);
    } finally {
      setLoadingPass(false);
    }
  }

  function reset2faUi() {
    setFaMsg("");
    setFaErr("");
    setQr("");
    setManualKey("");
    setCopied(false);
    setToken("");
  }

  async function setup2fa() {
    reset2faUi();
    setLoading2fa(true);

    try {
      const res = await fetch("/api/security/2fa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: user.email }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setFaErr(data?.error || t.security.setupFailed);
        setShowSetup(false);
        return;
      }

      setQr(data.qr || "");
      setManualKey(data.secret || "");
      setFaMsg(t.security.setupHint);
    } catch {
      setFaErr(t.security.networkError);
      setShowSetup(false);
    } finally {
      setLoading2fa(false);
    }
  }

  async function enable2fa() {
    setFaMsg("");
    setFaErr("");
    setLoading2fa(true);

    try {
      const res = await fetch("/api/security/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: user.email, token }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setFaErr(data?.error || t.security.invalidCode);
        return;
      }

      setTwoFaEnabled(true);
      setShowSetup(false);
      reset2faUi();
      setFaMsg(t.security.enabledMsg);

      // reset recovery UI
      setRecoveryCodes([]);
      setRecoveryMsg("");
      setRecoveryErr("");
      setShowRecoveryBox(false);
      setRecoveryOtp("");
    } catch {
      setFaErr(t.security.networkError);
    } finally {
      setLoading2fa(false);
    }
  }

  async function disable2fa() {
    setFaMsg("");
    setFaErr("");
    setLoading2fa(true);

    try {
      const res = await fetch("/api/security/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: user.email, token }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setFaErr(data?.error || t.security.disableFailed);
        return;
      }

      setTwoFaEnabled(false);
      setShowDisableBox(false);
      reset2faUi();
      setFaMsg(t.security.disabledMsg);

      // reset recovery UI + counters
      setRecoveryCodes([]);
      setRecoveryMsg("");
      setRecoveryErr("");
      setShowRecoveryBox(false);
      setRecoveryOtp("");
      setRecoveryTotal(0);
      setRecoveryRemaining(0);
    } catch {
      setFaErr(t.security.networkError);
    } finally {
      setLoading2fa(false);
    }
  }

  function copyManualKey() {
    if (!manualKey) return;
    navigator.clipboard.writeText(manualKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function onToggle2fa() {
    setFaMsg("");
    setFaErr("");

    if (!twoFaEnabled) {
      setShowDisableBox(false);
      setShowSetup(true);
      await setup2fa();
      return;
    }

    setShowSetup(false);
    setShowDisableBox(true);
    setToken("");
    setFaMsg(t.security.disableHint);
  }

  async function generateRecovery() {
    setRecoveryMsg("");
    setRecoveryErr("");

    if (!twoFaEnabled) {
      setRecoveryErr(t.security.enable2faFirst);
      return;
    }

    if (recoveryOtp.length !== 6) {
      setRecoveryErr(t.security.enterOtpToGenerate);
      return;
    }

    setLoadingRecovery(true);
    try {
      const res = await fetch("/api/security/2fa/recovery/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: recoveryOtp }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setRecoveryErr(data?.error || t.security.failedGenerate);
        return;
      }

      const codes = Array.isArray(data.codes) ? data.codes : [];
      setRecoveryCodes(codes);
      setRecoveryMsg(t.security.backupShownOnce);

      // ✅ update counters (Option 1)
      setRecoveryTotal(codes.length);
      setRecoveryRemaining(codes.length);
    } catch {
      setRecoveryErr(t.security.networkError);
    } finally {
      setLoadingRecovery(false);
    }
  }

  function downloadCodes(codes) {
    if (!codes?.length) return;
    const text = codes.join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function hideRecoveryCodes() {
    setRecoveryCodes([]);
    setRecoveryMsg("");
    setRecoveryErr("");
  }

  if (!user) return null;

  return (
    <div className="container">
      <Nav />

      <div
        className="glass section authBox securityBox"
        style={{ marginTop: 24 }}
      >
        <h1>{t.security.title}</h1>
        <p className="muted">{t.security.subtitle}</p>

        <div className="securityGrid" style={{ marginTop: 14 }}>
          {/* Change password */}
          <div className="sectionBox">
            <h3 style={{ marginTop: 0 }}>
              {t.security.changePasswordTitle}
            </h3>

            <form onSubmit={changePassword} className="authForm">
              {/* Current password */}
<div className="passField">
  <input
    type={showCurPass ? "text" : "password"}
    placeholder={t.security.currentPassword}
    value={curPass}
    onChange={(e) => setCurPass(e.target.value)}
    autoComplete="current-password"
    style={{ paddingRight: 44, width: "100%" }}
  />

  <button
    type="button"
    className="eyeBtn"
    onClick={() => setShowCurPass((v) => !v)}
    aria-label="Toggle password visibility"
  >
    {showCurPass ? "🙈" : "👁"}
  </button>
</div>

{/* New password */}
<div className="passField" style={{ marginTop: 12 }}>
  <input
    type={showNewPass ? "text" : "password"}
    placeholder={t.security.newPassword}
    value={newPass}
    onChange={(e) => setNewPass(e.target.value)}
    autoComplete="new-password"
    style={{ paddingRight: 44, width: "100%" }}
  />

  <button
    type="button"
    className="eyeBtn"
    onClick={() => setShowNewPass((v) => !v)}
    aria-label="Toggle password visibility"
  >
    {showNewPass ? "🙈" : "👁"}
  </button>
</div>

              {passErr ? <div className="errorBox">{passErr}</div> : null}
              {passMsg ? <div className="success">{passMsg}</div> : null}

              <button className="btnPrimary" disabled={loadingPass}>
                {loadingPass ? t.security.saving : t.security.save}
              </button>
            </form>
          </div>

          {/* 2FA */}
          <div className="sectionBox">
            <h3 style={{ marginTop: 0 }}>{t.security.twoFaTitle}</h3>

            <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
              {t.security.status}{" "}
              <b>{twoFaEnabled ? t.security.enabled : t.security.disabled}</b>
            </div>

            <button
              className={twoFaEnabled ? "btnPrimary" : "btnGhost"}
              type="button"
              onClick={onToggle2fa}
              disabled={loading2fa}
            >
              {twoFaEnabled ? t.security.turnOff : t.security.turnOn}
            </button>

            {faErr ? (
              <div className="errorBox" style={{ marginTop: 12 }}>
                {faErr}
              </div>
            ) : null}
            {faMsg ? (
              <div className="success" style={{ marginTop: 12 }}>
                {faMsg}
              </div>
            ) : null}

            {/* ✅ Backup Codes section */}
            {twoFaEnabled ? (
              <div style={{ marginTop: 14 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  {t.security.backupIntro}
                </div>

                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  {t.security.backupRemaining}{" "}
                  <b>{recoveryRemaining === null ? "-" : recoveryRemaining}</b> /{" "}
                  {recoveryTotal === null ? "-" : recoveryTotal}
                </div>

                <button
                  type="button"
                  className="btnGhost"
                  onClick={() => {
                    setShowRecoveryBox((v) => !v);
                    setRecoveryErr("");
                    setRecoveryMsg("");
                    setRecoveryOtp("");
                  }}
                  disabled={loadingRecovery}
                >
                  {showRecoveryBox
                    ? t.security.cancel
                    : recoveryTotal > 0
                    ? t.security.regenerate
                    : t.security.generate}
                </button>

                {showRecoveryBox ? (
                  <div style={{ marginTop: 10 }}>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                      {t.security.otpForBackupHint}
                    </div>

                    <input
                      inputMode="numeric"
                      placeholder={t.security.codePlaceholder}
                      value={recoveryOtp}
                      onChange={(e) =>
                        setRecoveryOtp(
                          e.target.value.replace(/\D/g, "").slice(0, 6)
                        )
                      }
                    />

                    <button
                      type="button"
                      className="btnPrimary"
                      style={{ marginTop: 8 }}
                      onClick={generateRecovery}
                      disabled={loadingRecovery || recoveryOtp.length !== 6}
                    >
                      {loadingRecovery
                        ? t.security.generating
                        : t.security.confirmGenerate}
                    </button>
                  </div>
                ) : null}

                {recoveryErr ? (
                  <div className="errorBox" style={{ marginTop: 10 }}>
                    {recoveryErr}
                  </div>
                ) : null}

                {recoveryMsg ? (
                  <div className="success" style={{ marginTop: 10 }}>
                    {recoveryMsg}
                  </div>
                ) : null}

                {recoveryCodes.length > 0 ? (
                  <div style={{ marginTop: 10 }}>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                      {t.security.saveCodesHint}
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: 8,
                      }}
                    >
                      {recoveryCodes.map((c) => (
                        <div
                          key={c}
                          className="glass"
                          style={{
                            padding: 10,
                            fontFamily: "monospace",
                            letterSpacing: 1,
                          }}
                        >
                          {c}
                        </div>
                      ))}
                    </div>

                    <div
                      style={{
                        marginTop: 10,
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        type="button"
                        className="btnPrimary"
                        onClick={() => downloadCodes(recoveryCodes)}
                      >
                        {t.security.downloadTxt}
                      </button>

                      <button type="button" className="btnGhost" onClick={hideRecoveryCodes}>
                        {t.security.hide}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div style={{ marginTop: 12 }}>
                  <details>
                    <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>
                      {t.security.lostCodesTitle}
                    </summary>

                    <div
                      className="muted"
                      style={{ fontSize: 12, marginTop: 8, lineHeight: 1.7 }}
                    >
                      {t.security.lostCodesText}
                    </div>
                  </details>
                </div>
              </div>
            ) : null}

            {/* OFF -> ON */}
            {showSetup && !twoFaEnabled ? (
              qr ? (
                <div style={{ marginTop: 12 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                    {t.security.scanHint}
                  </div>

                  <img src={qr} alt="2FA QR" style={{ width: 220, borderRadius: 12 }} />

                  {manualKey ? (
                    <div style={{ marginTop: 14 }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                        {t.security.manualKeyHint}
                      </div>

                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          className="input"
                          value={manualKey}
                          readOnly
                          style={{ fontFamily: "monospace", letterSpacing: 1 }}
                        />
                        <button type="button" className="btnGhost" onClick={copyManualKey}>
                          {copied ? t.security.copied : t.security.copy}
                        </button>
                      </div>

                      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                        {t.security.manualKeyHelp}
                      </div>
                    </div>
                  ) : null}

                  <div style={{ marginTop: 12 }}>
                    <input
                      inputMode="numeric"
                      placeholder={t.security.codePlaceholder}
                      value={token}
                      onChange={(e) =>
                        setToken(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                    />
                    <button
                      className="btnPrimary"
                      onClick={enable2fa}
                      disabled={loading2fa || token.length !== 6}
                      type="button"
                    >
                      {t.security.enableBtn}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="muted" style={{ marginTop: 12, fontSize: 12 }}>
                  {t.security.preparingQr}
                </div>
              )
            ) : null}

            {/* ON -> OFF */}
            {showDisableBox && twoFaEnabled ? (
              <div style={{ marginTop: 12 }}>
                <input
                  inputMode="numeric"
                  placeholder={t.security.codePlaceholder}
                  value={token}
                  onChange={(e) => setToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />

                <button
                  className="btnGhost"
                  onClick={disable2fa}
                  disabled={loading2fa || token.length !== 6}
                  type="button"
                  style={{ marginTop: 8 }}
                >
                  {loading2fa ? t.security.disabling : t.security.disableConfirm}
                </button>
              </div>
            ) : null}

            <div style={{ marginTop: 12 }}>
              <a className="btnGhost" href="/dashboard">
                {t.security.backToDashboard}
              </a>
            </div>
          </div>

          {/* ✅ Recent sign-ins */}
          <div className="sectionBox securityFull">
            <h3 style={{ marginTop: 0 }}>{t.security.recentSigninsTitle}</h3>

            {loginLog.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>
                {t.security.noLogs}
              </div>
            ) : (
              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t.security.table.time}</th>
                      <th>{t.security.table.event}</th>
                      <th>{t.security.table.status}</th>
                      <th>{t.security.table.ip}</th>
                      <th>{t.security.table.device}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loginLog.map((x) => (
                      <tr key={x.id}>
                        <td>{x.at ? new Date(x.at).toLocaleString() : "-"}</td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          {x.event}
                        </td>
                        <td>
                          {x.ok ? (
                            <span className="statusOk">{t.security.table.ok}</span>
                          ) : (
                            <span className="statusBad">{t.security.table.fail}</span>
                          )}
                        </td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          {x.ip || "-"}
                        </td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          {String(x.ua || "").slice(0, 45)}
                          {String(x.ua || "").length > 45 ? "…" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}