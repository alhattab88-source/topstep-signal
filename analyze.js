# Topstep AI Signal

## خطوات الرفع على Vercel

### 1. ارفع المجلد على GitHub
- افتح GitHub.com
- New Repository → اسمه `topstep-signal`
- ارفع كل الملفات

### 2. ارفع على Vercel
- افتح vercel.com
- New Project → اختر الـ repo
- اضغط Deploy

### 3. أضف API Key
- في Vercel → Settings → Environment Variables
- أضف:
  - Name:  ANTHROPIC_API_KEY
  - Value: sk-ant-api03-...مفتاحك الجديد...
- Redeploy

### الملفات
- `api/analyze.js` — Backend (يتصل بـ Anthropic)
- `public/index.html` — Frontend
- `vercel.json` — إعدادات Vercel
- `package.json` — Dependencies
