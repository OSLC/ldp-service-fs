/*
 * Copyright 2014 IBM Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/*
 * db.js stores RDF graphs in Apache Jena. Each document representations
 * an RDF graph. Documents have the properties below. The 'triples'
 * property is the RDF. Other properties are metadata.
 *
 */

var ldp = require('./vocab/ldp.js'); // LDP vocabulary
var fs = require('fs');
var db;
var write;

exports.init = function(env, callback) {

    console.log(fs.existsSync(env.URL));
    write = env.URL;
    if(fs.existsSync(write)){
        var file = fs.readFileSync(write);
        db = JSON.parse(file);
      
    }else{
        console.log("New file");
        db = {};
        fs.writeFileSync(write, JSON.stringify(db));
        

    }

    callback(null);
};

exports.reserveURI = function(uri, callback) {
	// simply create a document with only a URI. we will just update it later on put
	// if it fails, we reject the uri

    //db = fs.readFileSync(write);

    if(db === undefined || db === null){
        var err = {};
        err.stackCode = "Database does not exist";
        callback(err);
    }

    // db = JSON.parse(db);

	db[uri] = undefined;

    try{
        fs.writeFileSync(write, JSON.stringify(db));
    }catch(err){
        callback(err);
    }
    callback(null);  
};

exports.releaseURI = function(uri) {

    // db = fs.readFileSync(write);

    if(db === undefined || db === null){
        console.err("Database does not exist");d
    }

    // db = JSON.parse(db);

	db[uri] = null;
    fs.writeFileSync(write, JSON.stringify(db));

};

exports.put = function(uri, doc, content_type, callback) {
	console.log('db.put');

    // db = fs.readFileSync(write);
	console.log(db);
    // db = JSON.parse(db);
	db[uri] = doc;
    console.log(db);
    console.log(JSON.stringify(db));
    
    var res = {};

    try{
        fs.writeFileSync(write, JSON.stringify(db));
    }catch(err){
        res.statusCode = 500;
        callback(err, res);
    }
    res.statusCode = 200;
    callback(null, res);
	
};

exports.get = function(uri, content_type, callback) {

	console.log('db.get');

    var res = {};

    // db = fs.readFileSync(write);

    console.log(db);

    if(db === undefined || db === null){
        res.statusCode = 404;
        callback(null, res);
        
    }

    // db = JSON.parse(db);

    console.log("DB");
    console.log(db);

    if(db[uri] === undefined || db[uri] === null){
        console.log("EXEC");
        res.statusCode = 404;
        callback(null, res);

    }else{
        res.body = JSON.stringify(db[uri]);
        console.log(res.body);
        res.statusCode = 200;

        callback(null, res);

    }

};

/*
exports.query = function(uri, callback) {

    console.log('db.query');

    var options = {

        uri: db+"query?query="+uri,
        method: "GET",
        headers: {
            "Accept": "application/sparql-results+json"
        }
           
    };

    request(options, function(err, ires, body){
        console.log("REQUEST " + options.uri);
        if(err){
            callback(err);
        }

        console.log(body);
        console.log("REQUEST SUCCESS");
        callback(err, ires);

    });

};
*/

exports.remove = function(uri, callback) {

    var res = {};

    db = fs.readFileSync(write);

    if(db === undefined || db === null){
        res.statusCode = 404;
        callback(null, res);
    }

   // db = JSON.parse(db);

    if(db[uri] === null){
        res.statusCode = 404;
        callback(null, res);
    }
	db[uri] = undefined;

    try{
        fs.writeFileSync(write, JSON.stringify(db));
    }catch(err){
        res.statusCode = 500;
        callback(err, res);
    }

    res.statusCode = 200;
    
    callback(null);
    
};
