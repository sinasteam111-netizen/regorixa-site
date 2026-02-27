import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Nav from "../../components/Nav";
import { useLanguage } from "../../context/LanguageContext";
import { translations } from "../../translations";

function copyText(txt) {
  try {
    navigator.clipboard.writeText(String(txt || ""));
  } catch {}
}

export default function AdminPayoutsPage() {
  const router = useRouter();
  const { lang, dir } = useLanguage();

  // ✅ ترجمه‌ها (اگر بعداً خواستی متن‌ها رو چندزبانه کنی)
  useMemo(() => {
    const base = translations.en || {};
    const current = translations[lang] || base;
    return { ...base, ...current };
  }, [lang]);

  const [adminUser, setAdminUser] = useState(null);

  const [todayPayouts, setTodayPayouts] = useState({ today: "", base: [], advanced: [], vip: [], count: 0 });
  const [loadingPayouts, setLoadingPayouts] = useState(false);

  const [marking, setMarking] = useState({});

  // ✅ optional plan filter via query (?plan=base|advanced|vip)
  const planParam = String(router.query.plan || "").toLowerCase();
  const effectivePlan = planParam === "base" || planParam === "advanced" || planParam === "vip" ? planParam : "all";

  // ✅ امن: ادمین بودن فقط از سرور (session) تعیین میشه
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data?.ok || !data?.user?.email) {
          router.replace("/login");
          return;
        }

        const u = data.user;
        const role = String(u.role || "").toLowerCase();

        if (role !== "admin" && role !== "super_admin") {
          router.replace("/dashboard");
          return;
        }

        if (!mounted) return;
        setAdminUser(u);

        await loadTodayPayouts();
      } catch {
        router.replace("/login");
      }
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function loadTodayPayouts() {
    setLoadingPayouts(true);
    try {
      const res = await fetch("/api/admin/payouts/today");
      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.ok) {
        // ✅ حالت 1: API جدید (items/total/dateSofia)
        if (Array.isArray(data.items)) {
          const base = data.items.filter((x) => String(x?.plan || "").toLowerCase() === "base");
          const advanced = data.items.filter((x) => {
            const p = String(x?.plan || "").toLowerCase();
            return p === "advanced" || p === "adv";
          });
          const vip = data.items.filter((x) => String(x?.plan || "").toLowerCase() === "vip");

          setTodayPayouts({
            today: data.dateSofia || "",
            base,
            advanced,
            vip,
            count: Number(data.total || data.items.length || 0),
          });
        }
        // ✅ حالت 2: API قدیمی (base/advanced/vip/count/today)
        else {
          setTodayPayouts({
            today: data.today || "",
            base: Array.isArray(data.base) ? data.base : [],
            advanced: Array.isArray(data.advanced) ? data.advanced : [],
            vip: Array.isArray(data.vip) ? data.vip : [],
            count: Number(data.count || 0),
          });
        }
      } else {
        setTodayPayouts({ today: "", base: [], advanced: [], vip: [], count: 0 });
      }
    } catch {
      setTodayPayouts({ today: "", base: [], advanced: [], vip: [], count: 0 });
    } finally {
      setLoadingPayouts(false);
    }
  }

  async function markProfitPaid(row) {
    const key = `${row.orderId}-${row.dueAt || ""}`;
    setMarking((m) => ({ ...m, [key]: true }));

    try {
      const ok = confirm(
        `Mark as paid?\n\n${row.userEmail}\nPlan: ${row.plan}\nInvested: ${row.investedAmount || row.amount || 0} USDT\nDue: ${row.dueAt || "-"}`
      );
      if (!ok) return;

      const res = await fetch("/api/admin/payouts/mark-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: row.orderId, dueAt: row.dueAt }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        alert(data?.error || "Failed to mark paid");
        return;
      }

      await loadTodayPayouts();
      alert("Marked as paid.");
    } finally {
      setMarking((m) => {
        const x = { ...m };
        delete x[key];
        return x;
      });
    }
  }

  if (!adminUser) return null;

  const showBase = effectivePlan === "all" || effectivePlan === "base";
  const showAdvanced = effectivePlan === "all" || effectivePlan === "advanced";
  const showVip = effectivePlan === "all" || effectivePlan === "vip";

  return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Nav />

      <div className="glass section" style={{ marginTop: 24, padding: 28 }}>
        <div className="tagRow" style={{ marginBottom: 14 }}>
          <span className="tag">Admin</span>
          <span className="muted" style={{ fontSize: 12 }}>
            Today profit payouts • Mark paid • Base/Advanced/VIP
          </span>
        </div>

        <div className="sectionHeaderRow" style={{ alignItems: "center" }}>
          <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.2 }}>Payouts</h1>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 12 }}>
              Date (Sofia): <b>{todayPayouts.today || "-"}</b>
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              Total: <b>{todayPayouts.count || 0}</b>
            </span>
            <button className="btnGhost" onClick={loadTodayPayouts} disabled={loadingPayouts}>
              {loadingPayouts ? "Loading..." : "Refresh payouts"}
            </button>
          </div>
        </div>
        {/* فیلتر مثل withdrawals */}
        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btnGhost" type="button" onClick={() => router.push("/admin/payouts")}>
            All
          </button>
          <button className="btnGhost" type="button" onClick={() => router.push("/admin/payouts?plan=base")}>
            Base
          </button>
          <button className="btnGhost" type="button" onClick={() => router.push("/admin/payouts?plan=advanced")}>
            Advanced
          </button>
          <button className="btnGhost" type="button" onClick={() => router.push("/admin/payouts?plan=vip")}>
            VIP
          </button>

          <div style={{ flex: 1 }} />

          <button className="btnGhost" type="button" onClick={() => router.push("/admin")}>
            Back to admin
          </button>
        </div>
      </div>

      <div className="sectionBox" style={{ marginTop: 18 }}>
        {loadingPayouts ? (
          <div className="muted">Loading...</div>
        ) : (
          <div className="twoCol" style={{ marginTop: 0 }}>
            {/* BASE */}
            {showBase ? (
              <div className="sectionBox" style={{ marginTop: 0 }}>
                <h3 style={{ marginTop: 0 }}>BASE plan</h3>

                {todayPayouts.base.length === 0 ? (
                  <div className="muted" style={{ fontSize: 14 }}>
                    No BASE payouts due today.
                  </div>
                ) : (
                  <div className="tableWrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Invested</th>
                          <th>Invested at</th>
                          <th>Due</th>
                          <th>Wallet</th>
                          <th style={{ width: 150 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {todayPayouts.base.map((x, idx) => (
                          <tr key={`${x.orderId || "o"}-b-${idx}`}>
                            <td className="cellStrong">{x.userEmail || "-"}</td>

                            <td>{(x.investedAmount ?? x.amount) ? `${(x.investedAmount ?? x.amount)} USDT` : "-"}</td>

                            <td>{x.investedAt ? new Date(x.investedAt).toLocaleString() : "-"}</td>

                            <td>{x.dueAt ? new Date(x.dueAt).toLocaleString() : "-"}</td>

                            <td>
                              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <code className="txid">{x.payoutWallet || x.wallet || "-"}</code>
                                {(x.payoutWallet || x.wallet) ? (
                                  <button
                                    className="btnMini"
                                    onClick={() => copyText(x.payoutWallet || x.wallet)}
                                    title="Copy wallet"
                                  >
                                    Copy
                                  </button>
                                ) : null}
                              </div>
                            </td>

                            <td>
                              <button
                                className="btnPrimary"
                                type="button"
                                onClick={() => markProfitPaid(x)}
                                disabled={!!marking[`${x.orderId}-${x.dueAt || ""}`]}
                                style={{ padding: "8px 12px", fontSize: 12 }}
                              >
                                {marking[`${x.orderId}-${x.dueAt || ""}`] ? "Saving..." : "Mark as Paid"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}

            {/* ADVANCED */}
            {showAdvanced ? (
              <div className="sectionBox" style={{ marginTop: 0 }}>
                <h3 style={{ marginTop: 0 }}>ADVANCED plan</h3>

                {todayPayouts.advanced.length === 0 ? (
                  <div className="muted" style={{ fontSize: 14 }}>
                    No ADVANCED payouts due today.
                  </div>
                ) : (
                  <div className="tableWrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Invested</th>
                          <th>Invested at</th>
                          <th>Due</th>
                          <th>Wallet</th>
                          <th style={{ width: 150 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {todayPayouts.advanced.map((x, idx) => (
                          <tr key={`${x.orderId || "o"}-a-${idx}`}>
                            <td className="cellStrong">{x.userEmail || "-"}</td>

                            <td>{(x.investedAmount ?? x.amount) ? `${(x.investedAmount ?? x.amount)} USDT` : "-"}</td>

                            <td>{x.investedAt ? new Date(x.investedAt).toLocaleString() : "-"}</td>

                            <td>{x.dueAt ? new Date(x.dueAt).toLocaleString() : "-"}</td>

                            <td>
                              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <code className="txid">{x.payoutWallet || x.wallet || "-"}</code>
                                {(x.payoutWallet || x.wallet) ? (
                                  <button
                                    className="btnMini"
                                    onClick={() => copyText(x.payoutWallet || x.wallet)}
                                    title="Copy wallet"
                                  >
                                    Copy
                                  </button>
                                ) : null}
                              </div>
                            </td>

                            <td>
                              <button
                                className="btnPrimary"
                                type="button"
                                onClick={() => markProfitPaid(x)}
                                disabled={!!marking[`${x.orderId}-${x.dueAt || ""}`]}
                                style={{ padding: "8px 12px", fontSize: 12 }}
                              >
                                {marking[`${x.orderId}-${x.dueAt || ""}`] ? "Saving..." : "Mark as Paid"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
            {/* VIP */}
            {showVip ? (
              <div className="sectionBox" style={{ marginTop: 0 }}>
                <h3 style={{ marginTop: 0 }}>VIP plan</h3>

                {todayPayouts.vip.length === 0 ? (
                  <div className="muted" style={{ fontSize: 14 }}>
                    No VIP payouts due today.
                  </div>
                ) : (
                  <div className="tableWrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Invested</th>
                          <th>Invested at</th>
                          <th>Due</th>
                          <th>Wallet</th>
                          <th style={{ width: 150 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {todayPayouts.vip.map((x, idx) => (
                          <tr key={`${x.orderId || "o"}-v-${idx}`}>
                            <td className="cellStrong">{x.userEmail || "-"}</td>

                            <td>{(x.investedAmount ?? x.amount) ? `${(x.investedAmount ?? x.amount)} USDT` : "-"}</td>

                            <td>{x.investedAt ? new Date(x.investedAt).toLocaleString() : "-"}</td>

                            <td>{x.dueAt ? new Date(x.dueAt).toLocaleString() : "-"}</td>

                            <td>
                              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <code className="txid">{x.payoutWallet || x.wallet || "-"}</code>
                                {(x.payoutWallet || x.wallet) ? (
                                  <button
                                    className="btnMini"
                                    onClick={() => copyText(x.payoutWallet || x.wallet)}
                                    title="Copy wallet"
                                  >
                                    Copy
                                  </button>
                                ) : null}
                              </div>
                            </td>

                            <td>
                              <button
                                className="btnPrimary"
                                type="button"
                                onClick={() => markProfitPaid(x)}
                                disabled={!!marking[`${x.orderId}-${x.dueAt || ""}`]}
                                style={{ padding: "8px 12px", fontSize: 12 }}
                              >
                                {marking[`${x.orderId}-${x.dueAt || ""}`] ? "Saving..." : "Mark as Paid"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div style={{ height: 26 }} />
    </div>
  );
}
