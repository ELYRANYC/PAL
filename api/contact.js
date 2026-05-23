// Vercel Serverless Function — Catering / Wholesale inquiry form.
//
// To actually receive emails, set the following environment variables
// in your Vercel project (Settings → Environment Variables):
//
//   RESEND_API_KEY      API key from https://resend.com
//   CONTACT_TO_EMAIL    Where to deliver inquiries (e.g. orders@elyrapaletas.com)
//   CONTACT_FROM_EMAIL  Verified sender, e.g. forms@elyrapaletas.com
//
// Without these set, the function still returns 200 and logs the submission
// to the Vercel function logs so the site keeps working out-of-the-box.

import {
    isValidEmail,
    escapeHtml,
    readBody,
    isAllowedOrigin,
    clientIp,
    rateLimit,
} from '../lib/http.js';

const ALLOWED_FIELDS = [
    'inquiry-type', 'name', 'email', 'phone', 'contact-method',
    'date', 'quantity', 'event-type', 'venue',
    'business-name', 'business-type', 'frequency', 'notes'
];

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!isAllowedOrigin(req)) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    // 5 submissions per IP per 10 minutes. Tuned for a small site —
    // catering forms are rarely submitted in bursts by real humans.
    if (!rateLimit(`contact:${clientIp(req)}`, 5, 10 * 60 * 1000)) {
        res.setHeader('Retry-After', '600');
        return res.status(429).json({ error: 'Too many requests' });
    }

    let data;
    try {
        data = await readBody(req);
    } catch (err) {
        return res.status(err.statusCode || 400).json({ error: err.message });
    }

    // Honeypot — silently accept obvious bot submissions.
    if (data.elyra_check) {
        return res.status(200).json({ ok: true });
    }

    if (!data.name || !isValidEmail(data.email)) {
        return res.status(400).json({ error: 'Name and a valid email are required' });
    }

    // Build a readable summary using only whitelisted fields, length-capped.
    const submission = {};
    for (const key of ALLOWED_FIELDS) {
        if (data[key]) submission[key] = String(data[key]).slice(0, 2000);
    }

    const lines = Object.entries(submission)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');

    const htmlLines = Object.entries(submission)
        .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#5A483E;"><strong>${escapeHtml(k)}</strong></td><td style="padding:4px 0;">${escapeHtml(v).replace(/\n/g, '<br>')}</td></tr>`)
        .join('');

    const apiKey = process.env.RESEND_API_KEY;
    const toAddress = process.env.CONTACT_TO_EMAIL;
    const fromAddress = process.env.CONTACT_FROM_EMAIL;

    if (apiKey && toAddress && fromAddress) {
        try {
            const subject = `New ${submission['inquiry-type'] === 'retail' ? 'wholesale' : 'catering'} inquiry — ${submission.name}`;
            // Note: we intentionally do NOT set reply_to from user input.
            // The submitter email is included in the body for manual reply.
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: fromAddress,
                    to: [toAddress],
                    subject,
                    text: lines,
                    html: `<table style="font-family:Inter,sans-serif;font-size:14px;">${htmlLines}</table>`
                })
            });
            if (!response.ok) {
                const detail = await response.text();
                console.error('Resend error:', response.status, detail);
                return res.status(502).json({ error: 'Mail delivery failed' });
            }
        } catch (err) {
            console.error('Mail send threw:', err);
            return res.status(502).json({ error: 'Mail delivery failed' });
        }
    } else {
        // No mail provider configured — log and accept so the deploy still works.
        console.log('[contact] submission received (no mail provider configured):\n' + lines);
    }

    return res.status(200).json({ ok: true });
}
