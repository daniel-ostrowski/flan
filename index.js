var express = require('express');
var https = require('https');
var http = require('http');
var fs = require('fs');
var fileType = require('file-type');
var identifyBuffer = require('buffer-signature').identify;

var DAO = require('./DAO');
var NamedBlobRepository = require('./NamedBlobRepository');

var dao = new DAO("flan.db");
var namedBlobRepository = new NamedBlobRepository(dao);
var app = express();

app.set("view engine", "ejs");

var options = {
    cert: fs.readFileSync('../fullchain.pem', 'utf8'),
    key: fs.readFileSync('../privkey.pem', 'utf8'),
};

app.get("/", (req, res) => {
    res.send("Welcome to FLAN!");
});

app.get("/blobs/:id", (req, res) => {
    namedBlobRepository.getByID(req.params.id).then(blob => {
        if (blob) {
            var buffer = Buffer.from(blob["Data"]);
            // file-type only returns an object with a mime property if it could
            // determine a mime type confidently
            var mimeTypeGuessOne = fileType(buffer);
            mimeTypeGuessOne = mimeTypeGuessOne && mimeTypeGuessOne["mime"];
            // buffer-signature always returns an object with a mime property
            var mimeTypeGuessTwo = identifyBuffer(buffer)["mimeType"];
            // Prefer file-type's guess of the mime type.
            var mimeType = mimeTypeGuessOne || mimeTypeGuessTwo;
            res.contentType(mimeType);
            res.send(buffer);
        }
        else {
            res.type("text/plain");
            res.send("Blob not found!");
        }
    });
});

var server = https.createServer(options, app).listen(4443, function() {
    console.log("Server is now up.");
});

var http_redirect = http.createServer();
http.createServer(function (req, res) {
    res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
    res.end();
}).listen(8080);

