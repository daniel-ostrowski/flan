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
            blobDataPreprocessor(blob, req.query, req, res).then(blobData => blobDataPostprocessor(req, res, blobData, blob)).catch(errorHandler);
    };
}

async function expandBlobText(blobText) {
    const blobImportRegex = /<%- *includeBlob\("(.*?)"\) *%>/;
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
        if (Number.isInteger(params[key])) {
            sanitizedParams["$" + key] = Number.parseInt(params[key]);
        }
        else if (!Number.isNaN(Number.parseFloat(params[key]))) {
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
async function performEmbeddedQueries(blobText, params, req, blobID) {
    const queryRegex = /<%- *([A-Za-z_]*?) *= *executeSQL\("(.*?)"\) *%>/;
    params["blobID"] = blobID;
    for (var reqProperty in req) {
        params["req_" + reqProperty] = (req[reqProperty] && req[reqProperty].toString ? req[reqProperty].toString() :  "");
    }
    var sanitizedParams = sanitizeParametersForSQL(params);
    var templateData = {};
    while (true) {
        var matchData = blobText.match(queryRegex);
        if (matchData === null || matchData.length !== 3) {
            break;
        }
        const query = matchData[2];
        // sqlite gives a "SQLITE_RANGE" error when given SQL parameters that 
        // are not referenced
        var referencedParams = {};
        for (var param in sanitizedParams) {
            // This check to see if a param is used is not truly robust but is
            // sufficient for flan's intended use cases.
            if (query.includes(param)) {
                referencedParams[param] = sanitizedParams[param];
            }
        }
        templateData[matchData[1]] = await dao.all(query, referencedParams);
        blobText = blobText.replace(queryRegex, "");        
    }
    return [templateData, blobText];
}

function stuffEjsTemplateData(data, blob, queryParams, req, res) {
    data["blob"] = blob;
    data["query"] = queryParams;
    data["req"] = req;
    data["res"] = res;
    return data;
}

// Blob data pre-processors

async function identity(blob, queryParams, req, res) {
    return blob["Data"];
}

async function renderBlobText(blob, queryParams, req, res) {
    var expandedBlobText = await expandBlobText(blob["Data"]);
    return ejs.render(expandedBlobText, stuffEjsTemplateData({}, blob, queryParams, req, res)).toString();
}

async function renderBlobTextWithSqlData(blob, queryParams, req, res) {
    var expandedBlobText = await expandBlobText(blob["Data"]);
    var templateDataAndBlobText = await performEmbeddedQueries(expandedBlobText, queryParams, req, blob["ID"]);
    stuffEjsTemplateData(templateDataAndBlobText[0], blob, queryParams, req, res);
    return ejs.render(templateDataAndBlobText[1], templateDataAndBlobText[0]);
}

// Blob data post-processors

async function inferMimeTypeAndSendData(req, res, blobData, blob) {
    var buffer = Buffer.from(blobData);
    if (blob["MimeType"]) {
        res.contentType(blob["MimeType"]);
        console.log(blob["ID"] + " - " + blob["MimeType"]);
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

registerBlobRenderMethod("blobs", identity, inferMimeTypeAndSendData, logError);
registerBlobRenderMethod("texts", renderBlobText, inferMimeTypeAndSendData, logError);
registerBlobRenderMethod("posts", renderBlobTextWithSqlData, inferMimeTypeAndSendData, logError);

app.get("/", (req, res) => {
    req.params.id = "/";
    handleBlobRequest(req, res);
})

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