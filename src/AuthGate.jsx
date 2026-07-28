import React, { useState, useEffect } from "react";
import { Loader2, Lock, Mail } from "lucide-react";
import { supabase } from "./supabaseClient";

const T = {
  bg: "#F7F3EA",
  ink: "#1E1B2E",
  muted: "#86808F",
  amber: "#B8923F",
  amberDark: "#8F6F2C",
  rust: "#9C3B3B",
  rustBg: "#F6E8E5",
  green: "#1F6E4E",
  greenBg: "#E7F1EA",
  hairline: "#E4DCC8",
  card: "#FFFFFE",
  midnight: "#1B1E2B",
};

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: "12px",
  border: `1px solid ${T.hairline}`,
  background: "#fff",
  color: T.ink,
  fontFamily: "Vazirmatn",
  fontSize: "15px",
  outline: "none",
};

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  const submit = async () => {
    setError("");
    setInfo("");
    if (!email.trim() || !password) {
      setError("ایمیل و رمز عبور را وارد کنید.");
      return;
    }
    setBusy(true);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        if (error.message.toLowerCase().includes("email not confirmed")) {
          setError("ایمیلت هنوز تایید نشده. صندوق ایمیلت رو چک کن و روی لینک تاییدیه بزن، بعد دوباره وارد شو.");
        } else if (error.message.toLowerCase().includes("invalid login")) {
          setError("ایمیل یا رمز عبور اشتباه است.");
        } else {
          setError(error.message);
        }
      }
    } else {
      const { error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) setError(error.message.includes("already") ? "این ایمیل قبلاً ثبت شده — وارد شوید." : "خطا در ثبت‌نام. رمز باید حداقل ۶ کاراکتر باشد.");
      else setInfo("ثبت‌نام انجام شد! اگه ایمیل تاییدیه خواست، اول اونو تایید کن، بعد وارد شو.");
    }
    setBusy(false);
  };

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: T.midnight }}>
        <Loader2 className="animate-spin" color={T.amber} size={28} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: T.midnight }} dir="rtl">
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800&display=swap'); * { font-family: 'Vazirmatn', sans-serif; }`}</style>

        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-10">
          <div
            className="mb-7 flex items-center justify-center"
            style={{
              width: 72,
              height: 72,
              borderRadius: "9999px",
              border: `2px solid ${T.amber}`,
              boxShadow: `inset 0 0 0 3px ${T.midnight}, inset 0 0 0 4px ${T.amber}55`,
              transform: "rotate(-6deg)",
            }}
          >
            <span style={{ fontFamily: "Vazirmatn", fontWeight: 800, fontSize: "13px", color: T.amber, letterSpacing: "0.5px" }}>دفتر</span>
          </div>
          <h1 className="text-xl font-extrabold" style={{ color: "#fff" }}>دفتر حساب مشترک</h1>
          <p className="text-sm mt-1.5" style={{ color: "rgba(255,255,255,0.55)" }}>{mode === "signin" ? "برای ورود، ایمیل و رمز عبورت رو وارد کن." : "یه حساب جدید بساز تا وارد بشی."}</p>
        </div>

        <div className="rounded-t-[32px] px-6 pt-7 pb-9" style={{ background: T.bg }}>
          <div className="mb-3">
            <label className="flex items-center gap-1.5 mb-1.5 text-sm font-medium" style={{ color: T.muted }}>
              <Mail size={14} /> ایمیل
            </label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} dir="ltr" placeholder="you@example.com" />
          </div>
          <div className="mb-4">
            <label className="flex items-center gap-1.5 mb-1.5 text-sm font-medium" style={{ color: T.muted }}>
              <Lock size={14} /> رمز عبور
            </label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} dir="ltr" placeholder="••••••••" />
          </div>

          {error && <p className="text-sm mb-3 px-3 py-2 rounded-lg" style={{ color: T.rust, background: T.rustBg }}>{error}</p>}
          {info && <p className="text-sm mb-3 px-3 py-2 rounded-lg" style={{ color: T.green, background: T.greenBg }}>{info}</p>}

          <button
            onClick={submit}
            disabled={busy}
            className="w-full py-3 rounded-xl font-bold text-sm active:scale-[0.98] transition-transform"
            style={{ background: T.amber, color: "#fff", opacity: busy ? 0.7 : 1 }}
          >
            {busy ? "..." : mode === "signin" ? "ورود" : "ثبت‌نام"}
          </button>

          <button
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError("");
              setInfo("");
            }}
            className="w-full mt-3 text-sm"
            style={{ color: T.amberDark, fontWeight: 600 }}
          >
            {mode === "signin" ? "حساب نداری؟ ثبت‌نام کن" : "حساب داری؟ وارد شو"}
          </button>
        </div>
      </div>
    );
  }

  return children;
}
