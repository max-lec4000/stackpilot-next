"""From a second device: JSON test credentials on stdin, target test VM URL as argv[1]."""
import http.cookiejar, json, sys, urllib.request, urllib.error
base = sys.argv[1].rstrip('/')
assert base.startswith('http://') and base.endswith(':5173')
admin = json.load(sys.stdin)
client = urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def call(route, body=None, origin=None):
    headers = {'Content-Type':'application/json','Origin':origin or base}
    response = client.open(urllib.request.Request(base+route, data=json.dumps(body).encode() if body is not None else None,headers=headers),timeout=20)
    return json.load(response)
try:
    call('/api/admin-tailnet')
    raise AssertionError('Unauthenticated administration was allowed')
except urllib.error.HTTPError as error:
    assert error.code == 401
call('/api/auth/login',admin)
result=call('/api/admin-tailnet')
assert result['reachedViaTailnet'] is True
assert result['url']
call('/api/media/size-settings')
print('SECOND_DEVICE_TAILNET_LOGIN_AND_ADMIN_API_CONFIRMED')
