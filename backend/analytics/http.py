"""JSON response helpers shared by the data views and the auth views."""
import json
import math

from django.http import HttpResponse


def _clean(o):
    """NaN/Infinity are not valid JSON: emit them as null."""
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    return o


def jres(payload, status=200):
    try:
        text = json.dumps(payload, allow_nan=False, ensure_ascii=False)
    except ValueError:
        text = json.dumps(_clean(payload), ensure_ascii=False)
    return HttpResponse(text, status=status, content_type='application/json; charset=utf-8')


def body_json(request):
    try:
        b = json.loads(request.body or b'{}')
        return b if isinstance(b, dict) else {}
    except ValueError:
        return {}
