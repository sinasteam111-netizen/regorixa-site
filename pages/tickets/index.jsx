import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Nav from "../../components/Nav";
import { useLanguage } from "../../context/LanguageContext";

export default function TicketsIndex() {
  const router = useRouter();
  const { dir, t } = useLanguage();

  const [user, setUser] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  // ✅ مثل Dashboard/Security: user از session
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

        if (!mounted) return;

        setUser(data.user);
      } catch {
        router.replace("/login");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  // ✅ load tickets + mark read (badge صفر شود)
  useEffect(() => {
    if (!user?.email) return;

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const userId = String(user.email);

        const res = await fetch(`/api/tickets/list?userId=${encodeURIComponent(userId)}`);
        const data = await res.json().catch(() => ({}));

        if (cancelled) return;

        setTickets(Array.isArray(data?.tickets) ? data.tickets : []);

        // mark read
        await fetch("/api/tickets/mark-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        }).catch(() => {});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Nav />

      {/* Header like Security */}
      <div className="glass section" style={{ marginTop: 24, padding: 28 }}>
        <div className="tagRow" style={{ marginBottom: 14 }}>
          <span className="tag">{t("tickets.tag", "Tickets")}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {t("tickets.tagline", "Create & track support requests")}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.2 }}>
            {t("tickets.title", "My tickets")}
          </h1>

          <Link href="/tickets/new" className="btnGhost" style={{ alignSelf: "center" }}>
            {t("tickets.new", "New ticket")}
          </Link>
        </div>

        <p className="p" style={{ marginTop: 10, marginBottom: 0 }}>
          {t("tickets.desc", "View your tickets and admin replies here.")}
        </p>
      </div>

      {/* Content box like Security */}
      <div className="sectionBox" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>{t("tickets.listTitle", "Ticket list")}</h3>

        {!user ? (
          <div className="muted" style={{ fontSize: 14 }}>
            {t("tickets.loadingUser", "Loading...")}
          </div>
        ) : loading ? (
          <div className="muted" style={{ fontSize: 14 }}>
            {t("tickets.loading", "Loading tickets...")}
          </div>
        ) : tickets.length === 0 ? (
          <div className="muted" style={{ fontSize: 14 }}>
            {t("tickets.empty", "No tickets yet. Create a new one.")}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {tickets.map((tk) => (
              <div
                key={tk.id}
                style={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div className="cellStrong" style={{ fontSize: 16 }}>
                    {tk.title}
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
                  {t("tickets.createdAt", "Created:")}{" "}
                  <b>{tk.createdAt ? new Date(tk.createdAt).toLocaleString() : "-"}</b>
                  {tk.repliedAt ? (
                    <>
                      {" • "}
                      {t("tickets.repliedAt", "Replied:")}{" "}
                      <b>{new Date(tk.repliedAt).toLocaleString()}</b>
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
                      {t("tickets.adminReply", "Admin reply")}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{tk.adminReply}</div>
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                    {t("tickets.noReply", "No reply yet.")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ height: 26 }} />
    </div>
  );
}


