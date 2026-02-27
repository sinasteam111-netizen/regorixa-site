import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Nav from "../../components/Nav";
import { useLanguage } from "../../context/LanguageContext";

export default function AdminTicketsPage() {
  const router = useRouter();
  const { dir, t } = useLanguage();

  const [me, setMe] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyMap, setReplyMap] = useState({});
  const [unreadAdmin, setUnreadAdmin] = useState(0);

  // ✅ UI controls
  const [tab, setTab] = useState("all"); // all | new | open | answered | closed
  const [q, setQ] = useState("");
  const [sendingId, setSendingId] = useState(null);

  // ✅ قفل ادمین: فقط role=admin
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

        if (data.user.role !== "admin") {
          router.replace("/dashboard");
          return;
        }

        if (!mounted) return;
        setMe(data.user);
      } catch {
        router.replace("/dashboard");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  const loadTickets = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/tickets/list");
      const data = await res.json().catch(() => ({}));
      setTickets(Array.isArray(data?.tickets) ? data.tickets : []);
      setUnreadAdmin(Number(data?.unreadByAdmin || 0));
    } catch {
      setTickets([]);
      setUnreadAdmin(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!me) return;
    loadTickets();
    // ✅ هر 30 ثانیه آپدیت پنل ادمین
    const iv = setInterval(loadTickets, 30000);
    return () => clearInterval(iv);
  }, [me]);

  const sendReply = async (ticketId) => {
    const reply = (replyMap[ticketId] || "").trim();
    if (!reply) {
      alert(t("adminTickets.replyRequired", "Please enter a reply."));
      return;
    }

    setSendingId(ticketId);
    try {
      const res = await fetch("/api/admin/tickets/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, reply }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        alert(data?.error || "Failed to send reply");
        return;
      }

      setReplyMap((m) => ({ ...m, [ticketId]: "" }));
      await loadTickets();
      alert(t("adminTickets.replied", "Reply sent."));
    } finally {
      setSendingId(null);
    }
  };

  // ✅ sorted + filtered tickets
  const filteredTickets = useMemo(() => {
    const query = q.trim().toLowerCase();

    let arr = Array.isArray(tickets) ? tickets.slice() : [];

    // UI-side sort: newest first
    arr.sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0));

    // tab filter
    if (tab === "new") {
      arr = arr.filter((tk) => tk?.unreadByAdmin === true);
    } else if (tab === "open") {
      arr = arr.filter((tk) => String(tk?.status || "open") === "open");
    } else if (tab === "answered") {
      arr = arr.filter((tk) => String(tk?.status || "") === "answered");
    } else if (tab === "closed") {
      arr = arr.filter((tk) => String(tk?.status || "") === "closed");
    }

    // search filter
    if (query) {
      arr = arr.filter((tk) => {
        const hay = [
          tk?.title,
          tk?.message,
          tk?.adminReply,
          tk?.user?.name,
          tk?.user?.email,
          tk?.user?.id,
          tk?.status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return hay.includes(query);
      });
    }

    return arr;
  }, [tickets, tab, q]);

  // counters for tabs
  const counts = useMemo(() => {
    const arr = Array.isArray(tickets) ? tickets : [];
    return {
      all: arr.length,
      new: arr.filter((x) => x?.unreadByAdmin === true).length,
      open: arr.filter((x) => String(x?.status || "open") === "open").length,
      answered: arr.filter((x) => String(x?.status || "") === "answered").length,
      closed: arr.filter((x) => String(x?.status || "") === "closed").length,
    };
  }, [tickets]);

 const deleteTicket = async (ticketId) => {
  const ok = confirm("Delete this answered ticket? This cannot be undone.");
  if (!ok) return;

  const res = await fetch("/api/admin/tickets/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticketId }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    alert(data?.error || "Failed to delete ticket");
    return;
  }

  await loadTickets();
  alert("Ticket deleted.");
};

if (!me) return null;
 
return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Nav />

      {/* Header مثل Security */}
      <div className="glass section" style={{ marginTop: 24, padding: 28 }}>
        <div className="tagRow" style={{ marginBottom: 14 }}>
          <span className="tag">{t("adminTickets.tag", "Admin")}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {t("adminTickets.tagline", "Manage support tickets")}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.2 }}>
            {t("adminTickets.title", "Tickets")}
          </h1>

          <div className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
            {t("adminTickets.unread", "Unread")} : <b>{unreadAdmin}</b>
          </div>
        </div>

        <p className="p" style={{ marginTop: 10, marginBottom: 0 }}>
          {t("adminTickets.desc", "View all tickets, reply to users, and track status.")}
        </p>

        {/* Controls */}
        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            className={`btnGhost ${tab === "all" ? "btnActive" : ""}`}
            type="button"
            onClick={() => setTab("all")}
          >
            All ({counts.all})
          </button>

          <button
            className={`btnGhost ${tab === "new" ? "btnActive" : ""}`}
            type="button"
            onClick={() => setTab("new")}
            style={{ position: "relative" }}
          >
            New ({counts.new})
            {counts.new > 0 ? (
              <span
                style={{
                  marginInlineStart: 8,
                  display: "inline-block",
                  minWidth: 18,
                  height: 18,
                  padding: "0 6px",
                  borderRadius: 999,
                  fontSize: 12,
                  lineHeight: "18px",
                  background: "#e53935",
                  color: "#fff",
                  verticalAlign: "middle",
                }}
              >
                {counts.new}
              </span>
            ) : null}
          </button>

          <button
            className={`btnGhost ${tab === "open" ? "btnActive" : ""}`}
            type="button"
            onClick={() => setTab("open")}
          >
            Open ({counts.open})
          </button>

          <button
            className={`btnGhost ${tab === "answered" ? "btnActive" : ""}`}
            type="button"
            onClick={() => setTab("answered")}
          >
            Answered ({counts.answered})
          </button>

          <button
            className={`btnGhost ${tab === "closed" ? "btnActive" : ""}`}
            type="button"
            onClick={() => setTab("closed")}
          >
            Closed ({counts.closed})
          </button>

          <div style={{ flex: 1 }} />

          <input
            className="input"
            style={{ maxWidth: 360 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title / email / message..."
          />

          <button className="btnGhost" type="button" onClick={loadTickets}>
            Refresh
          </button>
        </div>
      </div>

      {/* لیست تیکت‌ها */}
      <div className="sectionBox" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>{t("adminTickets.listTitle", "All tickets")}</h3>

        {loading ? (
          <div className="muted" style={{ fontSize: 14 }}>
            {t("adminTickets.loading", "Loading...")}
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="muted" style={{ fontSize: 14 }}>
            {q.trim()
              ? "No results for your search."
              : tab === "new"
              ? "No new tickets."
              : t("adminTickets.empty", "No tickets yet.")}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {filteredTickets.map((tk) => (
              <div
                key={tk.id}
                style={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div className="cellStrong" style={{ fontSize: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span>{tk.title}</span>

                    {tk.unreadByAdmin ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 12,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "rgba(229,57,53,0.15)",
                          border: "1px solid rgba(229,57,53,0.35)",
                          color: "#fff",
                        }}
                      >
                        🟠 NEW
                      </span>
                    ) : null}
                  </div>

                  <span
                    className={
                      tk.status === "answered"
                        ? "statusOk"
                        : tk.status === "closed"
                        ? "statusBad"
                        : "statusPending"
                    }
                  >
                    {tk.status || "open"}
                  </span>
                </div>

                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  User: <b>{tk.user?.name || "-"}</b> • <b>{tk.user?.email || "-"}</b> • ID:{" "}
                  <b>{tk.user?.id || "-"}</b>
                </div>

                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  Created: <b>{tk.createdAt ? new Date(tk.createdAt).toLocaleString() : "-"}</b>
                  {tk.repliedAt ? (
                    <>
                      {" • "}Replied: <b>{new Date(tk.repliedAt).toLocaleString()}</b>
                    </>
                  ) : null}
                </div>

                <div style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>{tk.message}</div>

                {tk.adminReply ? (
                  <div
                    style={{
                      marginTop: 12,
                      border: "1px dashed rgba(255,255,255,0.18)",
                      borderRadius: 12,
                      padding: 12,
                    }}
                  >
                    <div className="cellStrong" style={{ marginBottom: 6 }}>
                      Admin reply
                    </div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{tk.adminReply}</div>
                  </div>
                ) : null}

                <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                  <textarea
                    className="input"
                    rows={4}
                    style={{ resize: "vertical" }}
                    placeholder="Write reply..."
                    value={replyMap[tk.id] || ""}
                    onChange={(e) => setReplyMap((m) => ({ ...m, [tk.id]: e.target.value }))}
                  />
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
  <button
    className={`btnPrimary ${sendingId === tk.id ? "btnDisabled" : ""}`}
    type="button"
    disabled={sendingId === tk.id}
    onClick={() => sendReply(tk.id)}
  >
    {sendingId === tk.id ? "Sending..." : "Send reply"}
  </button>

  <button className="btnGhost" type="button" onClick={loadTickets}>
    Refresh
  </button>

  {tk.status === "answered" && (tk.adminReply || "").trim() ? (
    <button
      className="btnGhost"
      type="button"
      onClick={() => deleteTicket(tk.id)}
      style={{ borderColor: "rgba(255,80,80,0.45)" }}
      title="Delete answered ticket"
    >
      Delete
    </button>
  ) : null}
</div>

                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ height: 26 }} />
    </div>
  );
}
