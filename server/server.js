#!/usr/bin/env node

var express    = require('express');
var keywords   = require('./db/keywords.json');
var data       = require('./db/data.json');
var _          = require('underscore');

function main() {
    var app = express();

    app.use('/keywords', function(req, res) {
        console.log('Requesting keywords');
        res.json(_.keys(keywords));
    });

    app.use('/search', function(req, res) {
        console.log(req.query);
    });

    app.listen(3000);
}

if (require.main === module) {
    main();
}

