'use strict';

var _           = require('underscore');
var mysql       = require('mysql');
var connection  = null;


function innerProduct(values1, values2) {
    var result = 0.0;

    for (var feature in values1) {
        result += values1[feature] * (values2[feature] || 0.0);
    }

    return result;
}

function scale(values, factor) {
    var result = {};

    for (var feature in values) {
        result[feature] = values[feature] * factor;
    }

    return result;
}

function add(values1, values2) {
    var result = {};

    for (var feature in values1) {
        result[feature] = values1[feature] + (values2[feature] || 0.0);
    }

    return result;
}

function combine(dict, params) {
    var result = {};

    for (var key in params) {
        var values = scale(dict[key], params[key]);
        result = add(values, result);
    }

    for (var key in result) {
        var value = result[key];
        value = Math.min(1.0, Math.max(-1.0, value));
        result[key] = value;
    }

    return result;
}

function walkRecords(data, searchParams, minScore, callback) {
    var features = combine(data.keywords, searchParams);

    for (var i = 0, count = data.records.length; i < count; ++i) {
        var record = data.records[i];
        var score  = innerProduct(features, record.rating);

        if (score >= minScore) {
            callback(record, score);
        }
    }

    return features;
}

function countRecords(data, searchParams, minScore) {
    var count = 0;
    walkRecords(data, searchParams, minScore, function(record, score) {
        ++count;
    });

    return count;
}

function findRecords(data, searchParams, minScore) {
    var results = [];
    walkRecords(data, searchParams, minScore, function(record, score) {
        results.push({
            name:  record.name,
            url:   'http://www.tripadvisor.com' + record.relativeUrl,
            score: score
        });
    });

    results.sort(function(a, b) {
        return b.score - a.score;
    });

    return results;
}

function step(range, steps, callback) {
    var stepSize = (range.max - range.min) / steps;

    for (var i = 0; i < steps; ++i) {
        var stepMax = range.max - stepSize * i;
        var stepMin = stepMax - stepSize;
        var stepMid = (stepMin + stepMax) / 2;

        callback(stepMid);
    }
}

function project(data, searchParams, minScore, keyword, range, steps) {
    var testParams = _.clone(searchParams);
    var results    = [];

    step(range, steps, function(position) {
        testParams[keyword] = position;
        results.push({
            sample: position,
            count:  countRecords(data, testParams, minScore)
        });
    });

    return results;
}

function buildHints(data, searchParams, minScore, keyword, range, steps) {
    var projection = project(
        data,
        searchParams,
        minScore,
        keyword,
        range,
        steps
    );

    var hints = [];
    _.each(projection, function(result) {
        hints.push({
            sample: result.sample,
            count:  result.count
        });
    });

    return hints;
}

function loadDb(params) {
    connection = mysql.createConnection(params);
}

function addKeyword(query, callback) {
    getKeywords(function(keywords) {
        var keyword  = query.keyword.toLowerCase();
        var features = combine(keywords, query.params);

        var values = [
            keyword,
            features.food || 0.0,
            features.service || 0.0,
            features.value || 0.0,
            features.atmosphere || 0.0
        ];

        connection.query('INSERT INTO keywords VALUES(?, ?, ?, ?, ?)', values, function(err) {
            callback({
                keyword: keyword,
                success: err === null
            });
        });
    });
}

function removeKeyword(query, callback) {
    connection.query('DELETE FROM keywords WHERE name=? AND name NOT IN (SELECT name FROM presets)', [query.keyword], function(err, fields) {
        callback({
            keyword: query.keyword,
            success: err === null && fields.affectedRows > 0
        });
    });
}

function getKeywords(callback) {
    connection.query('SELECT * FROM keywords', function(err, rows) {
        if (err) {
            throw err;
        }

        var keywords = {};
        for (var i = 0, count = rows.length; i < count; ++i) {
            var row = rows[i];
            keywords[row.name] = {
                food:       row.food,
                service:    row.service,
                value:      row.value,
                atmosphere: row.atmosphere
            };
        }

        callback(keywords);
    });
}

function getRecords(callback) {
    connection.query('SELECT * FROM reviews', function(err, rows) {
        if (err) {
            throw err;
        }

        var records = _.map(rows, function(row) {
            return {
                name:        row.name,
                relativeUrl: row.url,
                rating:      {
                    food:       row.food,
                    service:    row.service,
                    value:      row.value,
                    atmosphere: row.atmosphere
                }
            };
        });

        callback(records);
    });
}

function getData(callback) {
    getKeywords(function(keywords) {
        getRecords(function(records) {
            callback({
                keywords: keywords,
                records:  records
            });
        });
    });
}

function execQuery(query, callback) {
    getData(function(data) {
        var searchResults = findRecords(
            data,
            query.searchParams,
            query.minScore * _.keys(query.searchParams).length
        );

        var graphColumns = {};
        for (var keyword in query.searchParams) {
            var searchHints = buildHints(
                data,
                query.searchParams,
                query.minScore * _.keys(query.searchParams).length,
                keyword,
                query.searchRange,
                query.hintSteps
            );

            graphColumns[keyword] = {
                value: query.searchParams[keyword],
                hints: searchHints,
                steps: query.hintSteps
            }
        }

        callback({
            columns: graphColumns,
            items:   searchResults.slice(0, query.maxResults),
            count:   searchResults.length
        });
    });
}

module.exports = {
    'loadDb':        loadDb,
    'addKeyword':    addKeyword,
    'removeKeyword': removeKeyword,
    'getKeywords':   getKeywords,
    'execQuery':     execQuery
};