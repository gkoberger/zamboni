(function () {
    // "use strict";
    var $win = $(window),
        $chart = $('#head-chart'),
        $btnZoom = $('#chart-zoomout'),
        baseConfig = {
            chart: {
                renderTo: 'head-chart',
                zoomType: 'x',
                events: {
                    selection: function() {
                        $btnZoom.removeClass('inactive')
                                .click(_pd(function(e) {
                                    $(this).trigger('zoomout');
                                }));
                    }
                }
            },
            credits: { enabled: false },
            title: {
                text: null
            },
            xAxis: {
                type: 'datetime',
                maxZoom: 7 * 24 * 3600000, // seven days
                title: {
                    text: null
                },
                tickmarkPlacement: 'on'
            },
            yAxis: {
                title: {
                    text: null
                },
                labels: {
                    formatter: function() {
                        return Highcharts.numberFormat(this.value, 0);
                    }
                },
                minPadding: 0.05,
                startOnTick: false,
                showFirstLabel: false
            },
            legend: {
                enabled: true
            },
            tooltip: { },
            plotOptions: {
                line: {
                    lineWidth: 1,
                    animation: false,
                    shadow: false,
                    marker: {
                        enabled: true,
                        radius: 0,
                        states: {
                           hover: {
                              enabled: true,
                              radius: 5
                           }
                        }
                    },
                    states: {
                        hover: {
                            lineWidth: 2
                        }
                    }
                }
            }
        };
    Highcharts.setOptions({ lang: { resetZoom: '' } });
    var chart;
    // which unit do we use for a given metric?
    var metricTypes = {
        "usage"              : "users",
        "apps"               : "users",
        "locales"            : "users",
        "os"                 : "users",
        "versions"           : "users",
        "statuses"           : "users",
        "users_created"      : "users",
        "downloads"          : "downloads",
        "sources"            : "downloads",
        "contributions"      : "currency",
        "revenue"            : "currency",
        "reviews_created"    : "reviews",
        "addons_in_use"      : "addons",
        "addons_created"     : "addons",
        "addons_updated"     : "addons",
        "addons_downloaded"  : "addons",
        "collections_created": "collections",
        "subscribers"        : "collections",
        "ratings"            : "collections",
        "sales"              : "sales",
        "refunds"            : "refunds",
        "installs"           : "installs"
    };

    var acceptedGroups = {
        'day'   : true,
        'week'  : true,
        'month' : true
    };

    function showNoDataOverlay() {
        $chart.parent().addClass('nodata');
        $chart.parent().removeClass('loading');
        if (chart && chart.destroy) chart.destroy();
    }

    $win.bind("changeview", function() {
        $chart.parent().removeClass('nodata');
        $chart.addClass('loading');
    });

    $win.bind("dataready", function(e, obj) {
        var view    = obj.view,
            metric  = view.metric,
            group   = view.group,
            data    = obj.data,
            range   = normalizeRange(view.range),
            start   = range.start,
            end     = range.end,
            fields  = obj.fields ? obj.fields.slice(0,5) : ['count'],
            series  = {},
            events  = obj.events,
            chartRange = {},
            t, row, i, field, val,
            is_overview = metric == 'overview' || metric == 'app_overview';

        if (!(group in acceptedGroups)) {
            group = 'day';
        }

        if (obj.data.empty || !data.firstIndex) {
            showNoDataOverlay();
            $chart.removeClass('loading');
            return;
        }

        // Initialize the empty series object.
        _.each(fields, function(f) { series[f] = []; });

        // Transmute the data into something Highcharts understands.
        start = Date.iso(data.firstIndex);
        z.data = data;
        var step = '1 ' + group,
            point,
            dataSum = 0;

        forEachISODate({start: start, end: end}, '1 '+group, data, function(row, d) {
            for (i = 0; i < fields.length; i++) {
                field = fields[i];
                val = parseFloat(z.StatsManager.getField(row, field));
                if (val != val) val = null;
                series[field].push(val);
                if (val) dataSum += val;
            }
        }, this);

        // highCharts seems to dislike 0 and null data when determining a yAxis range
        if (dataSum === 0) {
            baseConfig.yAxis.max = 10;
        } else {
            baseConfig.yAxis.max = null;
        }

        // Populate the chart config object.
        var chartData = [], id;
        for (i = 0; i < fields.length; i++) {
            field = fields[i];
            id = field.split("|").slice(-1)[0];
            chartData.push({
                'type'  : 'line',
                'name'  : z.StatsManager.getPrettyName(view.metric, id),
                'id'    : id,
                'pointInterval' : 1000 * 3600 * 24,
                // compensate for timezone offsets from UTC.
                'pointStart' : start.getTime() - start.getTimezoneOffset() * 60000,
                'data'  : series[field],
                'visible' : !(metric == 'contributions' && id !='total')
            });
        }

        // Generate the tooltip function for this chart.
        // both x and y axis can be displayed differently.
        var tooltipFormatter = (function(){
            var xFormatter,
                yFormatter;
            function dayFormatter(d) { return Highcharts.dateFormat('%a, %b %e, %Y', new Date(d)); }
            function weekFormatter(d) { return format(gettext('Week of {0}'), Highcharts.dateFormat('%b %e, %Y', new Date(d))); }
            function monthFormatter(d) { return Highcharts.dateFormat('%B %Y', new Date(d)); }
            function downloadFormatter(n) { return gettext(Highcharts.numberFormat(n, 0) + 'downloads'); }
            function userFormatter(n) { return format(gettext('{0} users'), Highcharts.numberFormat(n, 0)); }
            function addonsFormatter(n) { return format(gettext('{0} addons'), Highcharts.numberFormat(n, 0)); }
            function collectionsFormatter(n) { return format(gettext('{0} collections'), Highcharts.numberFormat(n, 0)); }
            function reviewsFormatter(n) { return format(gettext('{0} reviews'), Highcharts.numberFormat(n, 0)); }
            function currencyFormatter(n) { return '$' + Highcharts.numberFormat(n, 2); }
            function salesFormatter(n) { return format(gettext('{0} sales'), Highcharts.numberFormat(n, 0)); }
            function refundsFormatter(n) { return format(gettext('{0} refunds'), Highcharts.numberFormat(n, 0)); }
            function installsFormatter(n) { return format(gettext('{0} installs'), Highcharts.numberFormat(n, 0)); }
            function addEventData(s, date) {
                var e = events[date];
                if (e) {
                    s += format('<br><br><b>{type_pretty}</b>', e);
                }
                return s;
            }

            // Determine x-axis formatter.
            if (group == "week") {
                xFormatter = weekFormatter;
            } else if (group == "month") {
                xFormatter = monthFormatter;
            } else {
                xFormatter = dayFormatter;
            }

            if (is_overview) {
                return function() {
                    var ret = "<b>" + xFormatter(this.x) + "</b>",
                        p;
                    for (var i=0; i < this.points.length; i++) {
                        p = this.points[i];
                        ret += '<br>' + p.series.name + ': ';
                        ret += Highcharts.numberFormat(p.y, 0);
                    }
                    return addEventData(ret, this.x);
                };
            } else if (metric == 'contributions') {
                return function() {
                    var ret = "<b>" + xFormatter(this.x) + "</b>",
                        p;
                    for (var i=0; i < this.points.length; i++) {
                        p = this.points[i];
                        ret += '<br>' + p.series.name + ': ';
                        if (p.series.options.yAxis > 0) {
                            ret += Highcharts.numberFormat(p.y, 0);
                        } else {
                            ret += currencyFormatter(p.y);
                        }
                    }
                    return addEventData(ret, this.x);
                };
            } else {
                // Determine y-axis formatter.
                switch (metricTypes[metric]) {
                    case "users":
                        yFormatter = userFormatter;
                        break;
                    case "downloads":
                        yFormatter = downloadFormatter;
                        break;
                    case "currency": case "revenue":
                        yFormatter = currencyFormatter;
                        break;
                    case "collections":
                        yFormatter = collectionsFormatter;
                        break;
                    case "reviews":
                        yFormatter = reviewsFormatter;
                        break;
                    case "addons":
                        yFormatter = addonsFormatter;
                        break;
                    case "sales":
                        yFormatter = salesFormatter;
                        break;
                    case "refunds":
                        yFormatter = refundsFormatter;
                        break;
                    case "installs":
                        yFormatter = installsFormatter;
                        break;
                }
                return function() {
                    var ret = "<b>" + this.series.name + "</b><br>" +
                              xFormatter(this.x) + "<br>" +
                              yFormatter(this.y);
                    return addEventData(ret, this.x);
                };
            }
        })();

        // Set up the new chart's configuration.
        var newConfig = $.extend(baseConfig, { series: chartData });
        // set up dual-axes for the overview chart.
        if (is_overview && newConfig.series.length) {
            _.extend(newConfig, {
                yAxis : [
                    { // Downloads
                        title: {
                           text: gettext('Downloads')
                        },
                        min: 0,
                        labels: {
                            formatter: function() {
                                return Highcharts.numberFormat(this.value, 0);
                            }
                        }
                    }, { // Daily Users
                        title: {
                            text: gettext('Daily Users')
                        },
                        labels: {
                            formatter: function() {
                                return Highcharts.numberFormat(this.value, 0);
                            }
                        },
                        min: 0,
                        opposite: true
                    }
                ],
                tooltip: {
                    shared : true,
                    crosshairs : true
                }
            });
            // set Daily Users series to use the right yAxis.
            if (metric == 'overview') {
                _.find(newConfig.series,
                   function(s) { return s.id == 'updates'; }).yAxis = 1;
            } else {
                _.find(newConfig.series,
                   function(s) { return s.id == 'usage'; }).yAxis = 1;
            }

        }
        if (metric == "contributions" && newConfig.series.length) {
            _.extend(newConfig, {
                yAxis : [
                    { // Amount
                        title: {
                            text: gettext('Amount, in USD')
                        },
                        labels: {
                            formatter: function() {
                                return Highcharts.numberFormat(this.value, 2);
                            }
                        },
                        min: 0
                    },
                    { // Number of Contributions
                        title: {
                           text: gettext('Number of Contributions')
                        },
                        min: 0,
                        labels: {
                            formatter: function() {
                                return Highcharts.numberFormat(this.value, 0);
                            }
                        },
                        opposite: true
                    }
                ],
                tooltip: {
                    shared : true,
                    crosshairs : true
                }
            });
            // set Daily Users series to use the right yAxis.
            newConfig.series[0].yAxis = 1;
        }
        newConfig.tooltip.formatter = tooltipFormatter;


        function makeSiteEventHandler(e) {
            return function() {
                var s = format('<h3>{type_pretty}</h3><p>{description}</p>', e);
                if (e.url) {
                    s += format('<p><a href="{0}" target="_blank">{1}</a></p>', [e.url, gettext('More Info...')]);
                }
                $('#exception-note h2').html(format(
                    // L10n: {0} is an ISO-formatted date.
                    gettext('Details for {0}'),
                    e.start
                ));
                $('#exception-note div').html(s);
                $chart.trigger('explain-exception');
            };
        }

        var pb = [], pl = [];
        eventColors = ['#DDD','#DDD','#FDFFD0','#D0FFD8'];
        _.forEach(events, function(e) {
            pb.push({
                color: eventColors[e.type],
                from: Date.iso(e.start).backward('12h'),
                to: Date.iso(e.end || e.start).forward('12h'),
                events: {
                    click: makeSiteEventHandler(e)
                }
            });
        });
        newConfig.xAxis.plotBands = pb;
        newConfig.xAxis.plotLines = pl;


        if (fields.length == 1) {
            newConfig.legend.enabled = false;
        }

        // Generate a pretty title for the chart.
        var title;
        if (typeof obj.view.range == 'string') {
            var numDays = parseInt(obj.view.range, 10);
            title = format(csv_keys.chartTitle[metric][0], numDays);
        } else {
            // This is a custom range so display a range shorter by one day.
            end = new Date(end.getTime() - (24 * 60 * 60 * 1000));
            title = format(csv_keys.chartTitle[metric][1], [start.iso(), end.iso()]);
        }
        newConfig.title = {
            text: title
        };
        if (chart && chart.destroy) chart.destroy();
        chart = new Highcharts.Chart(newConfig);

        chartRange = chart.xAxis[0].getExtremes();

        $win.bind('zoomout', function() {
            chart.xAxis[0].setExtremes(chartRange.min, chartRange.max);
            $btnZoom.addClass('inactive').click(_pd);
        });

        $chart.removeClass('loading');
    });
})();
