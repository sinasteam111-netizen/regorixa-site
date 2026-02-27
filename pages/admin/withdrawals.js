import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Nav from "../../components/Nav";

const TYPE_INVESTMENT = "investment";

function normalizeEmail(x) {
  return String(x || "").trim().toLowerCase();
}

function normalizeOrderType(o) {
  const t = String(o?.orderType || "").trim().toLowerCase();
  if (t === TYPE_INVESTMENT) return TYPE_INVESTMENT;
  return "plan";
}

function toNum(x) {
  const n = Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function copyText(txt) {
  try {
    navigator.clipboard.writeText(String(txt || ""));
  } catch {}
}

export default function AdminWithdrawalsPage() {
  const router = useRouter();

  const [adminUser, setAdminUser] = useState(null);

  const [rows, setRows] = useState([]);
  const [orders, setOrders] = useState([]);

  const [loading, setLoading] = useState(true);
  const [noteById, setNoteById] = useState({});
  const [savingId, setSavingId] = useState("");

  // UI مثل tickets: tab + search
  const [tab, setTab] = useState("pending"); // all | pending | approved | rejected
  const [q, setQ] = useState("");

  const abortRef = useRef(null);

  async function loadAll() {
    setLoading(true);

    // cancel previous in-flight loads
    try {
      abortRef.current?.abort?.();
    } catch {}
    const ac = new AbortController();
    abortRef.current = ac;

    const fetchJson = async (url, opts = {}) => {
      const r = await fetch(url, {
        ...opts,
        signal: ac.signal,
        credentials: "include",
        cache: "no-store",
        headers: {
          ...(opts.headers || {}),
          "Content-Type": opts.body ? "application/json" : (opts.headers?.["Content-Type"] || undefined),
        },
      });
      const d = await r.json().catch(() => ({}));
      return { r, d };
    };

    try {
      // ✅ auth / admin check
      const { r: meRes, d: meData } = await fetchJson("/api/auth/me");

      if (!meRes.ok || !meData?.ok || !meData?.user?.email) {
        router.push("/login");
        return;
      }

      const u = meData.user;
      const role = String(u.role || "").toLowerCase();
      if (role !== "admin") {
        router.push("/dashboard");
        return;
      }

      setAdminUser(u);

      // ✅ load withdrawals
      const { r: r1, d: d1 } = await fetchJson("/api/withdrawals/list");
      if (!r1.ok || !d1?.ok) {
        // if auth expired mid-request
        if (r1.status === 401 || r1.status === 403) {
          router.push("/login");
          return;
        }
        setRows([]);
      } else {
        setRows(Array.isArray(d1.withdrawals) ? d1.withdrawals : []);
      }

      // ✅ load orders for invested total
      const { r: r2, d: d2 } = await fetchJson("/api/auth/orders/admin-list");
      if (r2.ok && d2?.ok) {
        setOrders(Array.isArray(d2.orders) ? d2.orders : []);
      } else {
        if (r2.status === 401 || r2.status === 403) {
          router.push("/login");
          return;
        }
        setOrders([]);
      }
    } catch (e) {
      // ignore abort
      if (e?.name === "AbortError") return;
      router.push("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    return () => {
      try {
        abortRef.current?.abort?.();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ invested total per email (sum Approved investment amounts)
  const investedByEmail = useMemo(() => {
    const map = {};
    for (const o of orders || []) {
      const email = normalizeEmail(o?.userEmail);
      if (!email) continue;

      const isApproved = String(o?.status || "") === "Approved";
      const isInv = normalizeOrderType(o) === TYPE_INVESTMENT;
      if (!isApproved || !isInv) continue;

      map[email] = (map[email] || 0) + toNum(o?.amount);
    }
    return map;
  }, [orders]);

  // ✅ counts for tabs
  const counts = useMemo(() => {
    const all = (rows || []).length;
    const pending = (rows || []).filter((x) => String(x?.status || "") === "pending").length;
    const approved = (rows || []).filter((x) => String(x?.status || "") === "approved").length;
    const rejected = (rows || []).filter((x) => String(x?.status || "") === "rejected").length;
    return { all, pending, approved, rejected };
  }, [rows]);

  // ✅ filtered view (like tickets)
  const view = useMemo(() => {
    let list = (rows || []).slice();

    // newest first
    list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    if (tab !== "all") {
      list = list.filter((x) => String(x?.status || "pending") === tab);
    }

    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      list = list.filter(
        (x) =>
          String(x?.email || "").toLowerCase().includes(qq) ||
          String(x?.walletAddress || "").toLowerCase().includes(qq)
      );
    }

    return list;
  }, [rows, tab, q]);

  async function resolve(id, status) {
    setSavingId(id);
    try {
      const adminNote = String(noteById[id] || "");

      const r = await fetch("/api/withdrawals/resolve", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, adminNote }),
      });

      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) {
        if (r.status === 401 || r.status === 403) {
          router.push("/login");
          return;
        }
        alert(String(d?.error || "Failed"));
        setSavingId("");
        return;
      }

      await loadAll();
    } catch {
      alert("Failed");
    } finally {
      setSavingId("");
    }
  }

  if (!adminUser) return null;

  return (
    <div className="container" style={{ paddingBottom: 30 }}>
      <Nav />

      <div className="glass section" style={{ marginTop: 24, padding: 28 }}>
        <div className="tagRow" style={{ marginBottom: 14 }}>
          <span className="tag">Admin</span>
          <span className="muted" style={{ fontSize: 12 }}>
            Withdrawal requests • Approve/Reject • Notes
          </span>
        </div>

        <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.2 }}>Withdrawals</h1>

        <div className="muted" style={{ marginTop: 10 }}>
          Manage withdrawal requests, review invested totals, and approve/reject.
        </div>

        {/* Tabs + Search + Refresh مثل Tickets */}
        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btnGhost" type="button" onClick={() => setTab("all")}>
            All ({counts.all})
          </button>
          <button className="btnGhost" type="button" onClick={() => setTab("pending")}>
            Pending ({counts.pending})
          </button>
          <button className="btnGhost" type="button" onClick={() => setTab("approved")}>
            Approved ({counts.approved})
          </button>
          <button className="btnGhost" type="button" onClick={() => setTab("rejected")}>
            Rejected ({counts.rejected})
          </button>

          <div style={{ flex: 1 }} />

          <input
            className="input"
            placeholder="Search email / wallet..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: "min(360px, 100%)" }}
          />

          <button className="btnGhost" type="button" onClick={loadAll} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="sectionBox" style={{ marginTop: 18 }}>
        {loading ? (
          <div className="muted">Loading...</div>
        ) : view.length === 0 ? (
          <div className="muted">No withdrawal requests.</div>
        ) : (
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Email</th>
                  <th>Invested</th>
                  <th>Withdraw</th>
                  <th>Wallet</th>
                  <th>Status</th>
                  <th>Admin note</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {view.map((x) => {
                  const emailKey = normalizeEmail(x?.email);
                  const invested = investedByEmail[emailKey];

                  return (
                    <tr key={x.id}>
                      <td>{x.createdAt ? new Date(x.createdAt).toLocaleString() : "-"}</td>

                      <td className="cellStrong">
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span>{x.email}</span>
                          <button className="btnMini" type="button" onClick={() => copyText(x.email)} title="Copy email">
                            Copy
                          </button>
                        </div>
                      </td>

                      <td>
                        {typeof invested === "number" ? `${invested} USDT` : <span className="muted">No investment</span>}
                      </td>

                      <td>{toNum(x.amount)} USDT</td>

                      <td style={{ maxWidth: 260, wordBreak: "break-all" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <code className="txid">{x.walletAddress}</code>
                          {x.walletAddress ? (
                            <button
                              className="btnMini"
                              type="button"
                              onClick={() => copyText(x.walletAddress)}
                              title="Copy wallet"
                            >
                              Copy
                            </button>
                          ) : null}
                        </div>
                      </td>

                      <td>
                        {x.status === "approved" ? (
                          <span className="statusOk">approved</span>
                        ) : x.status === "rejected" ? (
                          <span className="statusBad">rejected</span>
                        ) : (
                          <span className="statusPending">pending</span>
                        )}
                      </td>

                      <td style={{ minWidth: 220 }}>
                        <input
                          className="input"
                          placeholder="Optional note..."
                          value={noteById[x.id] ?? x.adminNote ?? ""}
                          onChange={(e) => setNoteById((p) => ({ ...p, [x.id]: e.target.value }))}
                          disabled={x.status !== "pending" || savingId === x.id}
                        />
                      </td>

                      <td style={{ whiteSpace: "nowrap" }}>
                        {x.status === "pending" ? (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              className="btnPrimary"
                              type="button"
                              disabled={savingId === x.id}
                              onClick={() => resolve(x.id, "approved")}
                            >
                              Approve
                            </button>

                            <button
                              className="btnGhost"
                              type="button"
                              disabled={savingId === x.id}
                              onClick={() => resolve(x.id, "rejected")}
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              “Invested” is calculated from Approved investment orders (orders admin-list).
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
