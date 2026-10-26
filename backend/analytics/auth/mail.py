import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives

log = logging.getLogger('aif.auth')


def _html_body(name, code, link, ttl):
    spaced = '&nbsp; '.join(list(code))
    return f"""<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Reset your AIF Analytics password</title>
<style>
  @media (prefers-color-scheme: dark) {{
    .body-bg   {{ background-color: #0D1B14 !important; }}
    .card      {{ background-color: #1A2922 !important; }}
    .card-text {{ color: #A7C4B5 !important; }}
    .heading   {{ color: #E6F4EC !important; }}
    .code-box  {{ background-color: #0F2A1E !important; border-color: #2E6B4F !important; }}
    .code-text {{ color: #4ADE80 !important; }}
    .link-text {{ color: #4ADE80 !important; }}
    .footer    {{ color: #5A8A6E !important; }}
    .divider   {{ border-color: #2E4A38 !important; }}
    .ignore    {{ color: #7AAF90 !important; }}
  }}
</style>
</head>
<body class="body-bg" style="margin:0;padding:0;background-color:#F2F7F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F2F7F4;" class="body-bg">
  <tr>
    <td align="center" style="padding:40px 16px;">

      <!-- Card -->
      <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);" class="card">

        <!-- Header -->
        <tr>
          <td style="background-color:#1B5E40;padding:36px 40px 32px;" align="center">
            <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#A8D5B5;">AFRICA IMPROVED FOODS</p>
            <h1 style="margin:8px 0 0;font-size:26px;font-weight:700;color:#FFFFFF;letter-spacing:-0.5px;">AIF Analytics</h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px;" class="card">

            <h2 class="heading" style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1B2E22;">Reset your password</h2>
            <p class="card-text" style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#4A6555;">
              Hello {name},<br>
              We received a request to reset the password for your AIF Analytics account.
              Use the code or the button below — both expire in <strong>{ttl}&nbsp;minutes</strong>.
            </p>

            <!-- Code box -->
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td align="center" style="padding-bottom:28px;">
                  <table cellpadding="0" cellspacing="0" role="presentation">
                    <tr>
                      <td class="code-box" style="background-color:#EDF7F1;border:2px solid #A8D5B5;border-radius:10px;padding:20px 32px;" align="center">
                        <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#6B9E80;" class="card-text">Your 6-digit code</p>
                        <p class="code-text" style="margin:0;font-family:'Courier New',Courier,monospace;font-size:42px;font-weight:700;letter-spacing:6px;color:#1B5E40;">{spaced}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- CTA button -->
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td align="center" style="padding-bottom:20px;">
                  <!--[if mso]>
                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                    href="{link}" style="height:50px;v-text-anchor:middle;width:240px;" arcsize="12%"
                    stroke="f" fillcolor="#1B5E40">
                    <w:anchorlock/>
                    <center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:700;">Reset my password</center>
                  </v:roundrect>
                  <![endif]-->
                  <!--[if !mso]><!-->
                  <a href="{link}" style="display:inline-block;background-color:#1B5E40;color:#FFFFFF;font-size:16px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:6px;letter-spacing:0.3px;">Reset my password</a>
                  <!--<![endif]-->
                </td>
              </tr>
            </table>

            <!-- Paste link -->
            <p class="card-text" style="margin:0 0 6px;font-size:12px;color:#7A9B88;text-align:center;">Or paste this link into your browser:</p>
            <p style="margin:0 0 28px;font-size:11px;text-align:center;word-break:break-all;">
              <a href="{link}" class="link-text" style="color:#1B5E40;text-decoration:underline;">{link}</a>
            </p>

            <hr class="divider" style="border:none;border-top:1px solid #DFF0E7;margin:0 0 24px;">

            <!-- Ignore notice -->
            <p class="ignore" style="margin:0;font-size:13px;line-height:1.6;color:#7A9B88;text-align:center;">
              If you didn&rsquo;t request a password reset, you can safely ignore this email.<br>
              Your password will not change.
            </p>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background-color:#F7FBF8;padding:20px 40px;border-top:1px solid #DFF0E7;" class="code-box" align="center">
            <p class="footer" style="margin:0;font-size:12px;color:#8AAE97;">Africa Improved Foods &middot; AIF Analytics</p>
          </td>
        </tr>

      </table>
      <!-- /Card -->

    </td>
  </tr>
</table>
</body>
</html>"""


def send_reset_email(user, token, code):
    name = user.display_name or user.username
    link = f'{settings.APP_URL}/reset-password?token={token}'
    ttl = settings.RESET_TOKEN_TTL_MINUTES

    plain = (
        f'Hello {name},\n\n'
        f'A password reset was requested for your AIF Analytics account.\n\n'
        f'Your 6-digit code:\n\n'
        f'  {code}\n\n'
        f'Reset link (valid {ttl} minutes, single use):\n{link}\n\n'
        f'If you did not request this, you can safely ignore this email.\n'
    )

    if settings.EMAIL_BACKEND.endswith('dummy.EmailBackend'):
        log.warning(
            'Password reset requested for %s but no email provider is configured '
            '(set SMTP_HOST); nothing was sent.', user.username,
        )
        return 'none'

    try:
        msg = EmailMultiAlternatives(
            subject='AIF Analytics — reset your password',
            body=plain,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[user.email],
        )
        msg.attach_alternative(_html_body(name, code, link, ttl), 'text/html')
        msg.send(fail_silently=False)
        return 'console' if settings.EMAIL_BACKEND.endswith('console.EmailBackend') else 'sent'
    except Exception as e:
        log.error('Could not send the reset email to user %s: %s', user.username, e)
        return 'failed'
