# OCR v2 – رسیدهای فارسی

این نسخه شامل:

- OCR سمت سرور با OpenAI Vision؛ کلید API در مرورگر قرار نمی‌گیرد.
- پردازش تصویر با وضوح بالاتر و upscale کنترل‌شده برای عکس‌های کوچک/عکس‌برداری‌شده از روی گوشی دیگر.
- خروجی ساختاریافته برای مبلغ، تاریخ، ساعت، شماره سند، شماره پیگیری، شماره مرجع/رهگیری، کارت مقصد، فرستنده و گیرنده.
- بررسی «برچسب + مقدار همان ردیف» برای جلوگیری از قاطی شدن شماره‌های مشابه.
- confidence و evidence برای هر فیلد.
- دکمه «تلاش مجدد» که تصویر را با پردازش تقویت‌شده و reasoning بیشتر دوباره بررسی می‌کند.
- تیک کنار هر فیلد؛ فقط فیلدهای تیک‌خورده در `receiptInfo` ذخیره می‌شوند.

## Supabase migration

قبل از Deploy، فایل `supabase/receipt_info_migration.sql` را یک‌بار در SQL Editor پروژه Supabase اجرا کنید. این کار ستون `receipt_info` را به چهار جدول تراکنش اضافه می‌کند.

## Render

Environment Variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`
- `OPENAI_VISION_MODEL=gpt-5.4-mini`

Build Command:

`npm install && npm run build`

Start Command:

`npm start`
