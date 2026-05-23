// Vercel Serverless Function — Newsletter signup.
//
// To deliver signups somewhere, set environment variables in your Vercel
// project (Settings → Environment Variables). Two options:
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
// so the site still works out-of-the-box.

import {
    isValidEmail,
    readBody,
    isAllowedOrigin,
    clientIp,
    rateLimit,
} from '../lib/http.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!isAllowedOrigin(req)) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    // 3 signups per IP per hour. A real person signing up multiple times in
    // an hour is almost certainly accidental double-submits.
    if (!rateLimit(`newsletter:${clientIp(req)}`, 3, 60 * 60 * 1000)) {
        res.setHeader('Retry-After', '3600');
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
