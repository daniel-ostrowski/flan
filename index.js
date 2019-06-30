var express = require('express');
var https = require('https');
var http = require('http');
var fs = require('fs');
var fileType = require('file-type');
var ejs = require('ejs');
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

function handleBlobRequestGenerator(blobDataPreprocessor) {
    return function (req, res) {
        namedBlobRepository.getByID(req.params.id).then(blob => {
            if (blob) {
                blobDataPreprocessor(blob["Data"]).then(blobData => {
                    var buffer = Buffer.from(blobData);
                    // file-type only returns an object with a mime property if it 
                    // could determine a mime type confidently
                    var mimeTypeGuessOne = fileType(buffer);
                    mimeTypeGuessOne = mimeTypeGuessOne && mimeTypeGuessOne["mime"];
                    // buffer-signature always returns an object with a mime property
                    var mimeTypeGuessTwo = identifyBuffer(buffer)["mimeType"];
                    // Prefer file-type's guess of the mime type.
                    var mimeType = mimeTypeGuessOne || mimeTypeGuessTwo;
                    res.contentType(mimeType);
                    res.send(buffer);
                });
            }
            else {
                res.type("text/plain");
                res.send("Blob not found!");
            }
        });
    }
}

async function identity(x) {
    return x;
}

async function expandBlobText(blobText) {
    const blobImportRegex = /<%- *includeBlob\('(.*?)'\) *%>/;
    while (true) {
        var matchData = blobText.match(blobImportRegex);
        if (matchData === null || matchData.length !== 2) {
            break;
        }
        var importedBlob = await namedBlobRepository.getByID(matchData[1]);
        importedBlobText = importedBlob["Data"].toString();
        importedBlobText = await expandBlobText(importedBlobText);
        blobText = blobText.replace(blobImportRegex, importedBlobText);        
    }
    return blobText;
}

async function renderBlobText(blobText) {
    var expandedBlobText = await expandBlobText(blobText);
    return ejs.render(expandedBlobText).toString();
}

app.get("/", (req, res) => {
    res.send("Welcome to FLAN!");
});

app.get("/blobs/:id", (req, res) => {
    handleBlobRequestGenerator(identity)(req, res);
});

app.get("/posts/:id", (req, res) => {
    handleBlobRequestGenerator(renderBlobText)(req, res);
})

var server = https.createServer(options, app).listen(4443, function() {
    console.log("Server is now up.");
});

var http_redirect = http.createServer();
http.createServer(function (req, res) {
    res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
    res.end();
}).listen(8080);

