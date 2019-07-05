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

var blobRenderMethods = {};

function handleBlobRequest(req, res) {
    const blobID = req.params.id;
    namedBlobRepository.getByID(blobID).then(blob => {
        if (!blob) {
            res.status(404);
            res.type("text/plain");
            res.send("Requested blob was not found!");
        }
        else {
            var thisBlobsRenderMethod = blobRenderMethods[blob["RenderMethod"]];
            if (thisBlobsRenderMethod === undefined) {
                res.status(500);
                res.type("text/plain");
                res.send("The requested blob wants to be rendered via the '" + 
                    blob["RenderMethod"] + "' handler, but no handler with that name has been registered");
            }
            else {
                thisBlobsRenderMethod(req, res, blob, blobID);
            }
        }
    });
}

function registerBlobRenderMethod(renderMethodName, blobDataPreprocessor, blobDataPostprocessor, errorHandler) {
    blobRenderMethods[renderMethodName] = function (req, res, blob, blobID) {
            blobDataPreprocessor(blob, req.query).then(blobData => blobDataPostprocessor(req, res, blobData, blob)).catch(errorHandler);
    };
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

// Copy an object containing only string properties, converting any properties
// to integers or floats whenever possible.
function sanitizeParametersForSQL(params) {
    var sanitizedParams = {};
    for (var key in params) {
        if (Number.isInteger(key)) {
            sanitizedParams["$" + key] = Number.parseInt(params[key]);
        }
        else if (!Number.isNaN(key)) {
            sanitizedParams["$" + key] = Number.parseFloat(params[key]);
        }
        else {
            sanitizedParams["$" + key] = params[key];
        }
    }
    return sanitizedParams;
}

// Perform all the queries embedded within the blob text and return both an object 
// containing all the query results, suitable for passing into the EJS render
// function, and also return a copy of the blob text with all queries removed.
// Params is a dictionary of values that can be reference from within a query.
async function performEmbeddedQueries(blobText, params) {
    const queryRegex = /<%- *([A-Za-z_]*?) *= *executeSQL\('(.*?)'\) *%>/;
    var sanitizedParams = sanitizeParametersForSQL(params);
    var templateData = {};
    while (true) {
        var matchData = blobText.match(queryRegex);
        if (matchData === null || matchData.length !== 3) {
            break;
        }
        templateData[matchData[1]] = await dao.all(matchData[2], sanitizedParams);
        blobText = blobText.replace(queryRegex, "");        
    }
    return [templateData, blobText];
}

// Blob data pre-processors

async function identity(blob, queryParams) {
    return blob["Data"];
}

async function renderBlobText(blob, queryParams) {
    var expandedBlobText = await expandBlobText(blob["Data"]);
    return ejs.render(expandedBlobText, {query: queryParams, blob: blob}).toString();
}

async function renderBlobTextWithSqlData(blob, queryParams) {
    var expandedBlobText = await expandBlobText(blob["Data"]);
    var templateDataAndBlobText = await performEmbeddedQueries(expandedBlobText, queryParams);
    templateDataAndBlobText[0]["query"] = queryParams;
    templateDataAndBlobText[0]["blob"] = blob;
    return ejs.render(templateDataAndBlobText[1], templateDataAndBlobText[0]);
}

// Blob data post-processors

async function inferMimeTypeAndSendData(req, res, blobData, blob) {
    var buffer = Buffer.from(blobData);
    console.log(blob["MimeType"]);
    if (blob["MimeType"]) {
        res.contentType(blob["MimeType"]);
    }
    else {
        // file-type only returns an object with a mime property if it 
        // could determine a mime type confidently
        var mimeTypeGuessOne = fileType(buffer);
        mimeTypeGuessOne = mimeTypeGuessOne && mimeTypeGuessOne["mime"];
        // buffer-signature always returns an object with a mime property
        var mimeTypeGuessTwo = identifyBuffer(buffer)["mimeType"];
        // Prefer file-type's guess of the mime type.
        var mimeType = mimeTypeGuessOne || mimeTypeGuessTwo;
        res.contentType(mimeType);
    }
    res.send(buffer);
}

// Error handlers

function logError(obj) {
    console.log(obj);
}

// Express app setup and routing

var app = express();

app.set("view engine", "ejs");

var options = {
    cert: fs.readFileSync('../fullchain.pem', 'utf8'),
    key: fs.readFileSync('../privkey.pem', 'utf8'),
};

app.get("/", (req, res) => {
    res.send("Welcome to FLAN!");
});


registerBlobRenderMethod("blobs", identity, inferMimeTypeAndSendData, logError);
registerBlobRenderMethod("texts", renderBlobText, inferMimeTypeAndSendData, logError);
registerBlobRenderMethod("posts", renderBlobTextWithSqlData, inferMimeTypeAndSendData, logError);

app.get("/:id", (req, res) => {
    handleBlobRequest(req, res);
})

var server = https.createServer(options, app).listen(4443, function() {
    console.log("Server is now up.");
});

// Redirect any http request to the same url but with https
var http_redirect = http.createServer();
http.createServer(function (req, res) {
    res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
    res.end();
}).listen(8080);