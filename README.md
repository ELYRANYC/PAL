# Elyra Paletas

Static marketing site for Elyra Paletas (Highland, NY), deployed on **Vercel**.

## Project layout

```
.
├── index.html        Single-page site
├── api/
│   ├── contact.js    Vercel Serverless Function — catering / wholesale form
│   └── newsletter.js Vercel Serverless Function — newsletter signup
├── vercel.json       Vercel config (headers, clean URLs, caching)
├── package.json
└── .gitignore
```

## Deploying to Vercel

1. Push this repo to GitHub (or import directly into Vercel).
2. In the Vercel dashboard, **Add New → Project** and import the repo.
3. Framework preset: **Other**. No build command needed — `index.html` is served
   from the root, and `api/*.js` are auto-detected as Serverless Functions.
4. Configure the environment variables below, then deploy.

### Environment variables

Form submissions are emailed via [Resend](https://resend.com). Add the following
under **Settings → Environment Variables** in your Vercel project:

| Variable               | Purpose                                              |
|------------------------|------------------------------------------------------|
| `RESEND_API_KEY`       | API key from your Resend dashboard                   |
| `CONTACT_TO_EMAIL`     | Where catering / wholesale inquiries are delivered   |
| `NEWSLETTER_TO_EMAIL`  | Where newsletter signups are delivered               |
| `CONTACT_FROM_EMAIL`   | Verified sender address on your Resend domain        |

Without these, the API routes still respond `200 OK` and log submissions to the
Vercel function logs — useful while you're getting set up.

### Local development

```sh
npm i -g vercel
vercel dev
```

This serves the site at `http://localhost:3000` with the `/api/*` routes wired up.

## Migrating from Netlify

This project previously used Netlify Forms. The migration replaced:

- `data-netlify="true"` / `netlify-honeypot="bot-field"` form attributes — removed
- Form submissions — now POSTed as JSON to `/api/contact` and `/api/newsletter`
- The honeypot field is preserved and still checked server-side
