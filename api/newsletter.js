// Vercel Serverless Function — Newsletter signup
// Receives email signups from the footer newsletter form.
//
// To actually deliver these somewhere, set environment variables in your
// Vercel project (Settings → Environment Variables). Two options:
//
// (A) Send each signup as an email notification (default):
//     RESEND_API_KEY        from https://resend.com
//     NEWSLETTER_TO_EMAIL   where signups get notified
//     CONTACT_FROM_EMAIL    verified sender
//
// (B) Forward to a Mailchimp / Buttondown / ConvertKit list:
//     replace the fetch() call below with your provider's subscribe endpoint.
//
// Without anything configured, the function returns 200 and logs the email
// to the function logs so the site still works out-of-the-box.

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

    // Honeypot — silently accept obvious bot submissions
    if (data['bot-field']) {
        return res.status(200).json({ ok: true });
    }

    const email = (data.email || '').toString().trim().toLowerCase();
    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'A valid email is required' });
    }

    const apiKey = process.env.RESEND_API_KEY;
    const toAddress = process.env.NEWSLETTER_TO_EMAIL;
    const fromAddress = process.env.CONTACT_FROM_EMAIL;

    if (apiKey && toAddress && fromAddress) {
        try {
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: fromAddress,
                    to: [toAddress],
                    subject: 'New Elyra newsletter signup',
                    text: `New signup: ${email}`
                })
            });
            if (!response.ok) {
                const detail = await response.text();
                console.error('Resend error:', response.status, detail);
                return res.status(502).json({ error: 'Signup failed' });
            }
        } catch (err) {
            console.error('Mail send threw:', err);
            return res.status(502).json({ error: 'Signup failed' });
        }
    } else {
        console.log('[newsletter] signup received (no provider configured): ' + email);
    }

    return res.status(200).json({ ok: true });
}
