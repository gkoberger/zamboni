from datetime import date

import jingo

from addons.decorators import addon_view, addon_view_factory
from addons.models import Addon
from amo.decorators import json_view
from amo.urlresolvers import reverse
from mkt.webapps.models import Installed
from stats.models import Contribution, UpdateCount
from stats.views import (check_series_params_or_404, check_stats_permission,
                         get_report_view, render_csv, render_json, daterange)

SERIES = ('installs', 'usage', 'revenue', 'sales', 'refunds')
SERIES_GROUPS = ('day', 'week', 'month')
SERIES_GROUPS_DATE = ('date', 'week', 'month')
SERIES_FORMATS = ('json', 'csv')


@addon_view_factory(Addon.objects.valid)
def stats_report(request, addon, report):
    check_stats_permission(request, addon)
    stats_base_url = reverse('mkt.stats.overview', args=[addon.app_slug])
    view = get_report_view(request)
    return jingo.render(request, 'appstats/reports/%s.html' % report,
                        {'addon': addon,
                         'report': report,
                         'view': view,
                         'stats_base_url': stats_base_url,
                        })


def get_series(model, primary_field=None, extra_fields=[], **filters):
    """
    Get a generator of dicts for the stats model given by the filters.

    primary_field takes a field name that can be referenced by the key 'count'
    extra_fields takes a list of fields that can be found in the index
    on top of date and count and can be seen in the output
    """
    # Put a slice on it so we get more than 10 (the default), but limit to 365.
    qs = (model.search().order_by('-date').filter(**filters)
          .values_dict('date', 'count', primary_field, *extra_fields))[:365]
    for val in qs:
        # Convert the datetimes to a date.
        date_ = date(*val['date'].timetuple()[:3])

        if primary_field:
            rv = dict(count=val[primary_field], date=date_, end=date_)
        else:
            rv = dict(count=val['count'], date=date_, end=date_)

        for extra_field in extra_fields:
            rv[extra_field] = val[extra_field]
        yield rv


#TODO: complex JS logic similar to apps/stats, real stats data
@addon_view
def overview_series(request, addon, group, start, end, format):
    """Combines installs_series and usage_series into one payload."""
    date_range = check_series_params_or_404(group, start, end, format)
    check_stats_permission(request, addon)

    return fake_app_stats(request, addon, group, start, end, format)

    series = get_series(Installed, addon=addon.id, date__range=date_range)

    return render_json(request, addon, series)


@addon_view
def installs_series(request, addon, group, start, end, format):
    """Generate install counts grouped by ``group`` in ``format``."""
    date_range = check_series_params_or_404(group, start, end, format)
    check_stats_permission(request, addon)

    series = get_series(Installed, addon=addon.id, date__range=date_range)

    if format == 'csv':
        return render_csv(request, addon, series, ['date', 'count'])
    elif format == 'json':
        return render_json(request, addon, series)


@addon_view
def usage_series(request, addon, group, start, end, format):
    date_range = check_series_params_or_404(group, start, end, format)
    check_stats_permission(request, addon)

    series = get_series(UpdateCount, addon=addon.id, date__range=date_range)

    if format == 'csv':
        return render_csv(request, addon, series, ['date', 'count'])
    elif format == 'json':
        return render_json(request, addon, series)


@addon_view
def revenue_series(request, addon, group, start, end, format):
    date_range = check_series_params_or_404(group, start, end, format)
    check_stats_permission(request, addon, for_contributions=True)

    series = get_series(Contribution, primary_field='revenue',
        addon=addon.id, date__range=date_range)

    if format == 'csv':
        return render_csv(request, addon, series, ['date', 'count'])
    elif format == 'json':
        return render_json(request, addon, series)


@addon_view
def sales_series(request, addon, group, start, end, format):
    """
    Sequel to contribution series
    """
    date_range = check_series_params_or_404(group, start, end, format)
    check_stats_permission(request, addon, for_contributions=True)

    series = get_series(Contribution, addon=addon.id, date__range=date_range)

    if format == 'csv':
        return render_csv(request, addon, series, ['date', 'count'])
    elif format == 'json':
        return render_json(request, addon, series)


@addon_view
def refunds_series(request, addon, group, start, end, format):
    date_range = check_series_params_or_404(group, start, end, format)
    check_stats_permission(request, addon, for_contributions=True)

    series = get_series(Contribution, primary_field='refunds',
        addon=addon.id, date__range=date_range)

    if format == 'csv':
        return render_csv(request, addon, series, ['date', 'count'])
    elif format == 'json':
        return render_json(request, addon, series)


@json_view
def fake_app_stats(request, addon, group, start, end, format):
    from time import strftime
    from math import sin, floor
    start, end = check_series_params_or_404(group, start, end, format)
    faked = []
    val = 0
    for single_date in daterange(start, end):
        isodate = strftime("%Y-%m-%d", single_date.timetuple())
        faked.append({
         'date': isodate,
         'count': floor(200 + 50 * sin(val + 1)),
         'data': {
            'installs': floor(200 + 50 * sin(2 * val + 2)),
            'usage': floor(200 + 50 * sin(3 * val + 3)),
            #'device': floor(200 + 50 * sin(5 * val + 5)),
        }})
        val += .01
    return faked
