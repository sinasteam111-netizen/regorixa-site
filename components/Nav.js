import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";

function isAdminRole(role) {
  const r = String(role || "").toLowerCase();
  return r === "admin" || r === "super_admin";
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export default function Nav() {
  const router = useRouter();

  const [user, setUser] = useState(null); // from server session
  const [open, setOpen] = useState(false);

  // ✅ badges
  const [ticketUnreadUser, setTicketUnreadUser] = useState(0);
  const [ticketUnreadAdmin, setTicketUnreadAdmin] = useState(0);
  const [withdrawalsPending, setWithdrawalsPending] = useState(0);

  const pathname = router.pathname || "";
  const isActive = (href) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const isDashboard = pathname.startsWith("/dashboard");
  const isAdminPath = pathname.startsWith("/admin");

  // ✅ Now fixed to English-only for now
  const dir = "ltr";
  const admin = isAdminRole(user?.role);

  // prevent overlapping fetches
  const meAbortRef = useRef(null);
  const adminAbortRef = useRef(null);
  const userAbortRef = useRef(null);

  // light debounce for loadMe across fast route changes
  const meTimerRef = useRef(null);

  useEffect(() => {
    setOpen(false);
  }, [router.asPath]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dir = "ltr";
  }, []);

  async function loadMe() {
    try {
      if (meAbortRef.current) meAbortRef.current.abort();
      const ac = new AbortController();
      meAbortRef.current = ac;

      const res = await fetch("/api/auth/me", {
        method: "GET",
        credentials: "include",
        signal: ac.signal,
        headers: { "Cache-Control": "no-store" },
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.ok && data?.user?.email) {
        setUser(data.user);

        try {
          localStorage.setItem("regorixa_current_user", JSON.stringify(data.user));
        } catch {}
      } else {
        setUser(null);
      }
    } catch (e) {
      // ignore abort
      if (String(e?.name || "") !== "AbortError") setUser(null);
    }
  }

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {}

    try {
      localStorage.removeItem("regorixa_current_user");
    } catch {}

    setUser(null);
    router.push("/login");
  }

  // ✅ همیشه با سشن واقعی هماهنگ باشیم (با debounce سبک)
  useEffect(() => {
    if (meTimerRef.current) clearTimeout(meTimerRef.current);
    meTimerRef.current = setTimeout(() => {
      loadMe();
    }, 120);

    return () => {
      if (meTimerRef.current) clearTimeout(meTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.asPath]);

  // ✅ user tickets unread (only when user + dashboard)
  useEffect(() => {
    const loadUnread = async () => {
      try {
        if (userAbortRef.current) userAbortRef.current.abort();
        const ac = new AbortController();
        userAbortRef.current = ac;

        if (!user || !isDashboard) {
          setTicketUnreadUser(0);
          return;
        }

        // بهتره key ثابت باشه: ایمیل
        const key = String(user.email || "").trim().toLowerCase();
        if (!key) {
          setTicketUnreadUser(0);
          return;
        }

        const res = await fetch(`/api/tickets/unread-count?email=${encodeURIComponent(key)}`, {
          credentials: "include",
          signal: ac.signal,
          headers: { "Cache-Control": "no-store" },
        });

        const data = await res.json().catch(() => ({}));
        setTicketUnreadUser(safeNum(data?.count || 0));
      } catch (e) {
        if (String(e?.name || "") !== "AbortError") setTicketUnreadUser(0);
      }
    };

    loadUnread();
  }, [user, isDashboard, router.asPath]);

  // ✅ admin badges: unread tickets + pending withdrawals
  useEffect(() => {
    const loadAdminBadges = async () => {
      try {
        if (adminAbortRef.current) adminAbortRef.current.abort();
        const ac = new AbortController();
        adminAbortRef.current = ac;

        if (!admin) {
          setTicketUnreadAdmin(0);
          setWithdrawalsPending(0);
          return;
        }

        // unread by admin
        const tRes = await fetch("/api/admin/tickets/list", {
          credentials: "include",
          signal: ac.signal,
          headers: { "Cache-Control": "no-store" },
        });
        const tData = await tRes.json().catch(() => ({}));
        setTicketUnreadAdmin(safeNum(tData?.unreadByAdmin || 0));

        // pending withdrawals (admin endpoint)
        const wRes = await fetch("/api/withdrawals/list", {
          credentials: "include",
          signal: ac.signal,
          headers: { "Cache-Control": "no-store" },
        });
        const wData = await wRes.json().catch(() => ({}));
        const list = Array.isArray(wData?.withdrawals) ? wData.withdrawals : [];
        setWithdrawalsPending(list.filter((x) => String(x?.status || "") === "pending").length);
      } catch (e) {
        if (String(e?.name || "") !== "AbortError") {
          setTicketUnreadAdmin(0);
          setWithdrawalsPending(0);
        }
      }
    };

    loadAdminBadges();

    // پولینگ سبک فقط وقتی داخل /admin هستی
    if (!admin || !isAdminPath) return;
    const iv = setInterval(loadAdminBadges, 30000);
    return () => clearInterval(iv);
  }, [admin, isAdminPath, router.asPath]);

  const adminBadge = (ticketUnreadAdmin || 0) + (withdrawalsPending || 0);

  return (
    <header className="navWrap" dir={dir}>
      <nav className="navPro">
        {/* Left */}
        <div className="navLeft">
          <Link href="/" className="navBrand">
            REGORIXA
          </Link>

          <div className="navLinks navDesktop">
            <Link href="/" className={`navLink ${isActive("/") ? "navLinkActive" : ""}`}>
              Home
            </Link>

            <Link href="/transparency" className={`navLink ${isActive("/transparency") ? "navLinkActive" : ""}`}>
              Transparency
            </Link>

            <Link href="/faq" className={`navLink ${isActive("/faq") ? "navLinkActive" : ""}`}>
              FAQ
            </Link>

            <Link href="/about" className={`navLink ${isActive("/about") ? "navLinkActive" : ""}`}>
              About
            </Link>
          </div>
        </div>

        {/* Right */}
        <div className="navRight navDesktop">
          <Link href="/legal" className={`navLink ${isActive("/legal") ? "navLinkActive" : ""}`}>
            Legal
          </Link>

          {user ? (
            <>
              {/* ✅ Admin link only for admin roles */}
              {admin ? (
                <Link href="/admin" className={`navBtn ${isActive("/admin") ? "navBtnPrimary" : ""}`}>
                  Admin
                  {adminBadge > 0 ? <span className="badge">{adminBadge}</span> : null}
                </Link>
              ) : null}

              <Link href="/dashboard" className={`navBtn navBtnPrimary ${isActive("/dashboard") ? "navBtnActive" : ""}`}>
                Dashboard
                {ticketUnreadUser > 0 ? <span className="badge">{ticketUnreadUser}</span> : null}
              </Link>

              <button onClick={handleLogout} className="navBtn" type="button">
                Logout
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="navBtn">
                Login
              </Link>
              <Link href="/register" className="navBtn navBtnPrimary">
                Register
              </Link>
            </>
          )}
        </div>

        {/* Mobile burger */}
        <button className="navBurger" onClick={() => setOpen((s) => !s)} aria-label="Toggle menu" type="button">
          <span className="navBurgerLine" />
          <span className="navBurgerLine" />
        </button>
      </nav>

      {/* Mobile dropdown */}
      <div className={`navMobile ${open ? "navMobileOpen" : ""}`}>
        <div className="navMobileInner">
          <div className="navMobileLinks">
            <Link href="/" className={`navLink ${isActive("/") ? "navLinkActive" : ""}`}>
              Home
            </Link>

            <Link href="/transparency" className={`navLink ${isActive("/transparency") ? "navLinkActive" : ""}`}>
              Transparency
            </Link>

            <Link href="/faq" className={`navLink ${isActive("/faq") ? "navLinkActive" : ""}`}>
              FAQ
            </Link>

            <Link href="/about" className={`navLink ${isActive("/about") ? "navLinkActive" : ""}`}>
              About
            </Link>

            <Link href="/legal" className={`navLink ${isActive("/legal") ? "navLinkActive" : ""}`}>
              Legal
            </Link>
          </div>

          <div className="navMobileActions">
            {user ? (
              <>
                {admin ? (
                  <Link href="/admin" className="navBtn navBtnPrimary navBtnFull">
                    Admin {adminBadge > 0 ? <span className="badge">{adminBadge}</span> : null}
                  </Link>
                ) : null}

                <Link href="/dashboard" className="navBtn navBtnPrimary navBtnFull">
                  Dashboard {ticketUnreadUser > 0 ? <span className="badge">{ticketUnreadUser}</span> : null}
                </Link>

                <button onClick={handleLogout} className="navBtn navBtnFull" type="button">
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="navBtn navBtnFull">
                  Login
                </Link>
                <Link href="/register" className="navBtn navBtnPrimary navBtnFull">
                  Register
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};