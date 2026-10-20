/**
 * Confirmation email for the roaster-subscription interest list.
 *
 * Interest only: no payment, order, price, partnership or launch promise.
 * Links carry the token in the URL fragment (#token=...), which browsers
 * never send to a server, and the pages they open do nothing until the
 * person presses a button — link scanners can't confirm or unsubscribe.
 * No user-supplied text appears in the email.
 */

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildConfirmationEmail({ frontendOrigin, confirmToken, unsubscribeToken, confirmTtlHours }) {
    const confirmUrl = `${frontendOrigin}/waitlist/confirm/#token=${confirmToken}`;
    const unsubscribeUrl = `${frontendOrigin}/waitlist/unsubscribe/#token=${unsubscribeToken}`;
    const supportUrl = `${frontendOrigin}/pages/contact.html`;
    const privacyUrl = `${frontendOrigin}/pages/privacy.html`;
    const subject = 'Confirm your interest: local roaster coffee subscription';

    const text = [
        'Hi,',
        '',
        'Someone (hopefully you) asked to join the Local Coffee Shops interest list for a possible monthly coffee subscription featuring local roasters.',
        '',
        `To confirm, open this link and press "Confirm my interest" (the link expires in ${confirmTtlHours} hours):`,
        confirmUrl,
        '',
        "If you didn't ask for this, ignore this email - you won't be added to anything.",
        '',
        "This is an interest list only. There's no payment, no order and no commitment, and we can't promise a price, participating roasters or a launch date. We'll only email you about this subscription idea.",
        '',
        `Changed your mind? Unsubscribe at any time: ${unsubscribeUrl}`,
        `Questions: ${supportUrl}`,
        `Privacy: ${privacyUrl}`,
        '',
        'Local Coffee Shops',
    ].join('\n');

    const a = (href, label) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
    const html = `<!DOCTYPE html><html lang="en"><body style="font-family:Arial,sans-serif;line-height:1.5;color:#222">
<p>Hi,</p>
<p>Someone (hopefully you) asked to join the Local Coffee Shops interest list for a possible monthly coffee subscription featuring local roasters.</p>
<p><a href="${escapeHtml(confirmUrl)}" style="display:inline-block;padding:10px 16px;background:#2C3E50;color:#fff;text-decoration:none;border-radius:4px">Open the confirmation page</a></p>
<p>Then press &ldquo;Confirm my interest&rdquo;. The link expires in ${Number(confirmTtlHours)} hours.</p>
<p>If you didn&#39;t ask for this, ignore this email &ndash; you won&#39;t be added to anything.</p>
<p>This is an interest list only. There&#39;s no payment, no order and no commitment, and we can&#39;t promise a price, participating roasters or a launch date. We&#39;ll only email you about this subscription idea.</p>
<p>Changed your mind? ${a(unsubscribeUrl, 'Unsubscribe')} at any time. Questions? ${a(supportUrl, 'Contact us')}. ${a(privacyUrl, 'Privacy policy')}.</p>
<p>Local Coffee Shops</p>
</body></html>`;

    return { subject, text, html };
}

module.exports = { buildConfirmationEmail };
