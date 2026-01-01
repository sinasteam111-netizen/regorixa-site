import Link from "next/link";
import { useLanguage } from "../context/LanguageContext";

export default function Nav() {
  const { lang, setLang, dir } = useLanguage();

  const linkStyle = {
    color: "rgba(255,255,255,0.85)",
    textDecoration: "none",
    fontSize: 14,
  };

  return (
    <div className="nav" dir={dir}>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <div className="brand">REGORIXA</div>

        <Link href="/" legacyBehavior>
          <a style={linkStyle}>Home</a>
        </Link>

        <Link href="/transparency" legacyBehavior>
          <a style={linkStyle}>Transparency</a>
        </Link>
      </div>

      <select className="langSelect" value={lang} onChange={(e) => setLang(e.target.value)}>
        <option value="en">English</option>
        <option value="ar">Arabic</option>
        <option value="tr">Turkish</option>
        <option value="ru">Russian</option>
        <option value="es">Spanish</option>
        <option value="fr">French</option>
        <option value="de">German</option>
        <option value="pt">Portuguese</option>
        <option value="zh">Chinese</option>
        <option value="ja">Japanese</option>
        <option value="ko">Korean</option>
        <option value="it">Italian</option>
        <option value="id">Indonesian</option>
        <option value="hi">Hindi</option>
        <option value="ur">Urdu</option>
        <option value="bn">Bengali</option>
        <option value="vi">Vietnamese</option>
        <option value="th">Thai</option>
        <option value="az">Azerbaijani</option>
        <option value="fa">Persian</option>
      </select>
    </div>
  );
}
