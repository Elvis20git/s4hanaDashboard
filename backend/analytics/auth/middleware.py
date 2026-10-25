"""Security middleware: Helmet-style response headers, a strict CORS allow-list, and a CSRF defence for the cookie session.

Cookie sessions are SameSite=Strict (browsers do not send them on cross-site requests). As a second layer every state-changing /api
request must carry the custom X-AIF-Client header (or a Bearer token): a cross-site page cannot add it without a CORS preflight, which
this middleware only grants to the allow-listed origins."""
from django.conf import settings
from django.http import HttpResponse, JsonResponse

SAFE = ('GET', 'HEAD', 'OPTIONS')


class SecurityHeadersMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        resp = self.get_response(request)
        resp.setdefault('X-Content-Type-Options', 'nosniff')
        resp.setdefault('X-Frame-Options', 'DENY')
        resp.setdefault('Referrer-Policy', 'no-referrer')
        resp.setdefault('Cross-Origin-Resource-Policy', 'same-origin')
        if request.path.startswith('/api/'):
            resp.setdefault('Cache-Control', 'no-store')
            resp.setdefault('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
        if not settings.DEBUG:
            resp.setdefault('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
        return resp


class CorsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        origin = request.headers.get('Origin')
        own = f"{request.scheme}://{request.get_host()}"
        allowed = origin in settings.CORS_ALLOWED_ORIGINS if origin else True
        same = origin == own if origin else True
        if origin and not (allowed or same) and request.method not in SAFE:
            return JsonResponse({'success': False, 'message': 'Origin not allowed.'}, status=403)
        if request.method == 'OPTIONS' and origin and origin in settings.CORS_ALLOWED_ORIGINS:
            resp = HttpResponse(status=204)
            resp['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
            resp['Access-Control-Allow-Headers'] = 'Content-Type, X-AIF-Client, Authorization'
            resp['Access-Control-Max-Age'] = '600'
        else:
            resp = self.get_response(request)
        if origin and origin in settings.CORS_ALLOWED_ORIGINS:
            resp['Access-Control-Allow-Origin'] = origin
            resp['Access-Control-Allow-Credentials'] = 'true'
            resp['Vary'] = 'Origin'
        return resp


class ApiGuardMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith('/api/') and request.method not in SAFE:
            if not request.headers.get('X-AIF-Client') and not (request.headers.get('Authorization') or '').startswith('Bearer '):
                return JsonResponse({'success': False, 'message': 'Missing X-AIF-Client header.'}, status=403)
        return self.get_response(request)
