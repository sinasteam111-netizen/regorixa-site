import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Nav from "../../components/Nav";
import { useLanguage } from "../../context/LanguageContext";

export default function NewTicket() {
  const router = useRouter();
  const { dir, t } = useLanguage();

  const [user, setUser] = useState(null);

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

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

  const submit = async (e) => {
    e.preventDefault();
    if (!user?.email) return;

    if (!title.trim() || !message.trim()) {
      alert(t("tickets.form.required", "Please fill title and message."));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/tickets/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          message,
          user: {
            id: user.email, // ✅ همین رو ثابت نگه می‌داریم
            email: user.email,
            name: user.firstName || user.email,
          },
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error || "Failed to create ticket");
        return;
      }

      alert(t("tickets.form.created", "Ticket created."));
      router.push("/tickets");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container" dir={dir} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
      <Nav />

      {/* Header like Security */}
      <div className="glass section" style={{ marginTop: 24, padding: 28 }}>
        <div className="tagRow" style={{ marginBottom: 14 }}>
          <span className="tag">{t("tickets.newTag", "New ticket")}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {t("tickets.newTagline", "Send a request to support")}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.2 }}>
            {t("tickets.newTitle", "Create ticket")}
          </h1>

          <Link href="/tickets" className="btnGhost" style={{ alignSelf: "center" }}>
            {t("tickets.back", "Back to tickets")}
          </Link>
        </div>

        <p className="p" style={{ marginTop: 10, marginBottom: 0 }}>
          {t("tickets.newDesc", "Describe your issue and we will reply as soon as possible.")}
        </p>
      </div>

      {/* Form box like Security */}
      <div className="sectionBox" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>{t("tickets.form.title", "Ticket form")}</h3>

        {!user ? (
          <div className="muted" style={{ fontSize: 14 }}>
            {t("tickets.loadingUser", "Loading...")}
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: "grid", gap: 12, maxWidth: 820 }}>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("tickets.form.titlePh", "Title")}
            />

            <textarea
              className="input"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("tickets.form.msgPh", "Message")}
              rows={7}
              style={{ resize: "vertical" }}
            />

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className={`btnPrimary ${loading ? "btnDisabled" : ""}`} disabled={loading} type="submit">
                {loading ? t("tickets.form.sending", "Sending...") : t("tickets.form.send", "Send ticket")}
              </button>

              <Link href="/tickets" className="btnGhost">
                {t("tickets.form.cancel", "Cancel")}
              </Link>
            </div>
          </form>
        )}
      </div>

      <div style={{ height: 26 }} />
    </div>
  );
}

