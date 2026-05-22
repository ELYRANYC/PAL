// Vercel Serverless Function — Catering / Wholesale inquiry form
// Receives submissions from the catering form on the homepage.
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

const ALLOWED_FIELDS = [
    'inquiry-type', 'name', 'email', 'phone', 'contact-method',
    'date', 'quantity', 'event-type', 'venue',
    'business-name', 'business-type', 'frequency', 'notes'
];

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function readBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
        try { return JSON.parse(req.body); } catch { /* fall through */ }
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return {};
    const contentType = (req.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('application/json')) {
        try { return JSON.parse(raw); } catch { return {}; }
    }
    if (contentType.includes('application/x-www-form-urlencoded')) {
        return Object.fromEntries(new URLSearchParams(raw));
    }
    try { return JSON.parse(raw); } catch { return {}; }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const data = await readBody(req);

    // Honeypot — if a bot fills this in, silently pretend we accepted it
    if (data['bot-field']) {
        return res.status(200).json({ ok: true });
    }

    if (!data.name || !isValidEmail(data.email)) {
        return res.status(400).json({ error: 'Name and a valid email are required' });
    }

    // Build a readable summary, only with whitelisted fields
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
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: fromAddress,
                    to: [toAddress],
                    reply_to: submission.email,
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
        // No mail provider configured — log and accept so the deploy still works
        console.log('[contact] submission received (no mail provider configured):\n' + lines);
    }

    return res.status(200).json({ ok: true });
}
