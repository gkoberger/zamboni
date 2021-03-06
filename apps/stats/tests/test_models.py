# -*- coding: utf-8 -*-
from datetime import datetime, timedelta
import json

from django.conf import settings
from django.core import mail
from django.db import models
from django.utils import translation

import phpserialize as php
from nose.tools import eq_

import amo
import amo.tests
from addons.models import Addon
from stats.models import Contribution
from stats.db import StatsDictField
from users.models import UserProfile
from market.models import Refund

class TestStatsDictField(amo.tests.TestCase):

    def test_to_python_none(self):
        eq_(StatsDictField().to_python(None), None)

    def test_to_python_dict(self):
        eq_(StatsDictField().to_python({'a': 1}), {'a': 1})

    def test_to_python_php(self):
        val = {'a': 1}
        eq_(StatsDictField().to_python(php.serialize(val)), val)

    def test_to_python_json(self):
        val = {'a': 1}
        eq_(StatsDictField().to_python(json.dumps(val)), val)


class TestContributionModel(amo.tests.TestCase):
    fixtures = ['stats/test_models.json']

    def setUp(self):
        self.con = Contribution.objects.get(pk=1)
        self.con.update(type=amo.CONTRIB_PURCHASE)

    def test_related_protected(self):
        user = UserProfile.objects.create(username='foo@bar.com')
        addon = Addon.objects.create(type=amo.ADDON_EXTENSION)
        payment = Contribution.objects.create(user=user, addon=addon)
        Contribution.objects.create(user=user, addon=addon, related=payment)
        self.assertRaises(models.ProtectedError, payment.delete)

    def test_locale(self):
        translation.activate('en_US')
        eq_(Contribution.objects.all()[0].get_amount_locale(), u'$1.99')
        translation.activate('fr')
        eq_(Contribution.objects.all()[0].get_amount_locale(), u'1,99\xa0$US')

    def test_instant_refund(self):
        self.con.update(created=datetime.now())
        assert self.con.is_instant_refund(), 'Refund should be instant'

    def test_not_instant_refund(self):
        diff = timedelta(seconds=settings.PAYPAL_REFUND_INSTANT + 10)
        self.con.update(created=datetime.now() - diff)
        assert not self.con.is_instant_refund(), "Refund shouldn't be instant"


    def test_refund_inapp_instant(self):
        for ctype in ('CONTRIB_INAPP', 'CONTRIB_INAPP_PENDING'):
            self.con.update(created=datetime.now(), type=getattr(amo, ctype))
            assert not self.con.is_instant_refund(), (
                                        'No refund on %s inapp' % ctype)

    def test_refund_inapp_not_instant(self):
        diff = timedelta(seconds=settings.PAYPAL_REFUND_INSTANT + 10)
        for ctype in ('CONTRIB_INAPP', 'CONTRIB_INAPP_PENDING'):
            self.con.update(created=datetime.now() - diff,
                            type=getattr(amo, ctype))
            assert not self.con.is_instant_refund(), (
                                        'No refund on %s inapp' % ctype)

class TestEmail(amo.tests.TestCase):
    fixtures = ['base/users', 'base/addon_3615']

    def setUp(self):
        self.addon = Addon.objects.get(pk=3615)
        self.user = UserProfile.objects.get(pk=999)

    def make_contribution(self, amount, locale, type):
        return Contribution.objects.create(type=type, addon=self.addon,
                                           user=self.user, amount=amount,
                                           source_locale=locale)

    def chargeback_email(self, amount, locale):
        cont = self.make_contribution(amount, locale, amo.CONTRIB_CHARGEBACK)
        cont.mail_chargeback()
        eq_(len(mail.outbox), 1)
        return mail.outbox[0]

    def test_chargeback_email(self):
        email = self.chargeback_email('10', 'en-US')
        eq_(email.subject, u'%s payment reversal' % self.addon.name)
        assert str(self.addon.name) in email.body

    def test_chargeback_negative(self):
        email = self.chargeback_email('-10', 'en-US')
        assert '$10.00' in email.body

    def test_chargeback_positive(self):
        email = self.chargeback_email('10', 'en-US')
        assert '$10.00' in email.body

    def test_chargeback_unicode(self):
        self.addon.name = u'Азәрбајҹан'
        self.addon.save()
        email = self.chargeback_email('-10', 'en-US')
        assert '$10.00' in email.body

    def test_chargeback_locale(self):
        self.addon.name = {'fr': u'België'}
        self.addon.locale = 'fr'
        self.addon.save()
        email = self.chargeback_email('-10', 'fr')
        assert u'België' in email.body
        assert u'10,00\xa0$US' in email.body

    def notification_email(self, amount, locale, method):
        cont = self.make_contribution(amount, locale, amo.CONTRIB_REFUND)
        getattr(cont, method)()
        eq_(len(mail.outbox), 1)
        return mail.outbox[0]

    def test_accepted_email(self):
        email = self.notification_email('10', 'en-US', 'mail_approved')
        eq_(email.subject, u'%s refund approved' % self.addon.name)
        assert str(self.addon.name) in email.body

    def test_accepted_unicode(self):
        self.addon.name = u'Азәрбајҹан'
        self.addon.save()
        email = self.notification_email('10', 'en-US', 'mail_approved')
        assert '$10.00' in email.body

    def test_accepted_locale(self):
        self.addon.name = {'fr': u'België'}
        self.addon.locale = 'fr'
        self.addon.save()
        email = self.notification_email('-10', 'fr', 'mail_approved')
        assert u'België' in email.body
        assert u'10,00\xa0$US' in email.body

    def test_declined_email(self):
        email = self.notification_email('10', 'en-US', 'mail_declined')
        eq_(email.subject, u'%s refund declined' % self.addon.name)

    def test_declined_unicode(self):
        self.addon.name = u'Азәрбајҹан'
        self.addon.save()
        email = self.notification_email('10', 'en-US', 'mail_declined')
        eq_(email.subject, u'%s refund declined' % self.addon.name)

    def test_failed_email(self):
        cont = self.make_contribution('10', 'en-US', amo.CONTRIB_PURCHASE)
        msg = 'oh no'
        cont.record_failed_refund(msg)
        eq_(Refund.objects.count(), 1)
        rf = Refund.objects.get(contribution=cont)
        eq_(rf.status, amo.REFUND_FAILED)
        eq_(rf.rejection_reason, msg)
        eq_(len(mail.outbox), 2)
        usermail, devmail = mail.outbox
        eq_(usermail.to, [self.user.email])
        eq_(devmail.to, [self.addon.support_email])
        assert msg in devmail.body
