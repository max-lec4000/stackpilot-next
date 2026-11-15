from authentik.core.models import User, Group, Application
from authentik.stages.authenticator_totp.models import TOTPDevice
from authentik.policies.engine import PolicyEngine
from django.test import RequestFactory
for name, enrolled, viewer in [('fixture-no-mfa',False,True),('fixture-mfa',True,True),('fixture-outsider',True,False)]:
    user, _ = User.objects.get_or_create(username=name, defaults={'name':name})
    user.set_password('Fixture-Identity-Test-2026!')
    user.save()
    if viewer: user.groups.add(Group.objects.get(name='stackpilot-viewers'))
    if enrolled: TOTPDevice.objects.get_or_create(user=user,name='fixture-only',defaults={'key':'a1'*20,'confirmed':True})
app = Application.objects.get(slug='stackpilot-jellyfin')
for name, expected in [('fixture-mfa',True),('fixture-outsider',False),('akadmin',False)]:
    user=User.objects.get(username=name)
    req=RequestFactory().get('/')
    req.user=user
    engine=PolicyEngine(app,user,request=req)
    engine.use_cache=False
    result=engine.build().result.passing
    assert result == expected, name
print('Fixture viewer, outsider and administrator policies verified')

from authentik.stages.authenticator_static.models import StaticDevice, StaticToken
recovery, _ = StaticDevice.objects.get_or_create(user=User.objects.get(username='fixture-mfa'), name='fixture-recovery', defaults={'confirmed':True})
StaticToken.objects.get_or_create(device=recovery, token='fixture-recovery-only')
