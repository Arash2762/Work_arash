# دفتر حساب مشترک

اپ حسابداری با ورود مشترک (ایمیل/رمز عبور) و دیتابیس Supabase.

## دیپلوی روی Vercel (بدون نیاز به کدنویسی)

### گزینه ۱ — از طریق GitHub (پیشنهادی)
1. یه ریپازیتوری جدید و **خصوصی (Private)** توی [github.com](https://github.com) بساز
2. همه فایل‌های این پوشه رو توش آپلود کن (از دکمه "Add file → Upload files" توی خود سایت گیت‌هاب هم میشه، نیازی به دستور نیست)
3. برو [vercel.com](https://vercel.com) → با همون اکانت گیت‌هاب وارد شو
4. **Add New → Project** → ریپازیتوری‌ای که ساختی رو انتخاب کن
5. توی بخش **Environment Variables** این دو مقدار رو اضافه کن (از فایل `.env` همین پروژه کپی کن):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. دکمه **Deploy** رو بزن

بعد از چند دقیقه یه لینک مثل `your-project.vercel.app` بهت میده — همونیه که هم تو هم شریکت باهاش وارد میشید.

### گزینه ۲ — آپلود مستقیم (بدون گیت‌هاب)
1. توی [vercel.com](https://vercel.com) اکانت بساز
2. نصب Vercel CLI روی کامپیوترت: `npm i -g vercel`
3. توی همین پوشه پروژه، دستور `vercel` رو بزن و مراحلش رو دنبال کن

## بعد از دیپلوی
- تو و شریکت هر کدوم جدا یه حساب (ایمیل/رمز) توی خود اپ می‌سازید (دکمه "ثبت‌نام کن")
- هر دو حسابی که بسازید، دقیقاً به یه دیتابیس مشترک وصلن — یعنی هر چی یکی‌تون وارد کنه، اون یکی هم می‌بینه
- برای امنیت بیشتر، بعداً می‌تونی از تنظیمات Supabase (Authentication → Providers → Email) گزینه «ثبت‌نام آزاد» رو ببندی تا فقط همون دو نفر بتونن وارد بشن

## توسعه محلی (اختیاری، برای برنامه‌نویس‌ها)
```
npm install
npm run dev
```

## OCR هوشمند رسید (Render + Vision)

این نسخه یک Backend دارد. مرورگر عکس را به `/api/ocr-receipt` می‌فرستد و سرور آن را به Vision API می‌دهد. کلید API فقط روی سرور نگهداری می‌شود.

### متغیرهای Render
- `VITE_SUPABASE_URL` = URL پروژه Supabase
- `VITE_SUPABASE_ANON_KEY` = Publishable/Anon key Supabase
- `OPENAI_API_KEY` = کلید API سرویس Vision (فقط در Render)
- `OPENAI_VISION_MODEL` = `gpt-5.4-mini`

### دیپلوی
Build Command:
`npm install && npm run build`

Start Command:
`npm start`

بعد از Deploy می‌توانی برای تست سلامت OCR مسیر `/api/health` را باز کنی. باید `visionConfigured: true` نشان دهد.
