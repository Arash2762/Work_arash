import React, { useState, useEffect } from "react";
import { Loader2, Lock, Mail } from "lucide-react";
import { supabase } from "./supabaseClient";

const T = {
  bg: "#FBF7F1",
  ink: "#2B2438",
  muted: "#7A7288",
  amber: "#D98E3F",
  amberDark: "#B9711F",
  rust: "#B5482F",
  rustBg: "#F8E9E4",
  hairline: "#E7E0D4",
  card: "#FFFFFF",
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
      <div className="min-h-screen flex items-center justify-center" style={{ background: T.bg }}>
        <Loader2 className="animate-spin" color={T.amber} size={28} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center px-5" style={{ background: T.bg }} dir="rtl">
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800&display=swap'); * { font-family: 'Vazirmatn', sans-serif; }`}</style>
        <div className="w-full max-w-sm rounded-3xl p-6" style={{ background: T.card, border: `1px solid ${T.hairline}` }}>
          <h1 className="text-xl font-extrabold mb-1" style={{ color: T.ink }}>دفتر حساب مشترک</h1>
          <p className="text-sm mb-6" style={{ color: T.muted }}>{mode === "signin" ? "برای ورود، ایمیل و رمز عبورت رو وارد کن." : "یه حساب جدید بساز تا وارد بشی."}</p>

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

          {error && (
            <p className="text-sm mb-3 px-3 py-2 rounded-lg" style={{ color: T.rust, background: T.rustBg }}>{error}</p>
          )}
          {info && (
            <p className="text-sm mb-3 px-3 py-2 rounded-lg" style={{ color: "#3F7D58", background: "#E9F3ED" }}>{info}</p>
          )}

          <button
            onClick={submit}
            disabled={busy}
            className="w-full py-3 rounded-xl font-bold text-sm"
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
