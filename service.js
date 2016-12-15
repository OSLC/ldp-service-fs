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
 * server.js is Express middleware that handles HTTP requests for LDP resources.
 */

var express = require('express');
var appBase = undefined;
var rdflib = require('./rdflib');
var http = require('http');
var https = require('https');
var fs = require('fs');

/*
 * Middleware to create the full URI for the request for use in 
 * JSON-LD and MongoDB identifiers.
 */
var fullURL = function(req, res, next) {
	req.fullURL = appBase + req.originalUrl;
	next();
}

/* 
 * Middleware to create a UTF8 encoded copy of the original request body
 * used in JSON and N3 parsers.
 */
var rawBody = function(req, res, next) {
	req.rawBody = '';
	req.setEncoding('utf8');

	req.on('data', function(chunk) {
		req.rawBody += chunk;
	});

	req.on('end', function() {
		next();
	});
}

var ldp = require('./vocab/ldp.js'); // LDP vocabulary
var rdf = require('./vocab/rdf.js'); // RDF vocabulary
var media = require('./media.js'); // media types
var turtle = require('./turtle.js'); // text/turtle parsing and serialization
var jsonld = require('./jsonld.js'); // application/ld+json parsing and serialization
var crypto = require('crypto'); // for MD5 (ETags)

/*
 * Middleware to handle all LDP requests
 */
var ldpRoutes = function(db, env) {

	var subApp = express();
	subApp.use(fullURL);
	subApp.use(rawBody);
	var resource = subApp.route(env.context + '*');

	// route any requests matching the LDP context (defaults to /r/*)
	resource.all(function(req, res, next) {
		// all responses should have Link: <ldp:Resource> rel=type
		var links = {
			type: ldp.Resource
		};
		// also include implementation constraints
		links[ldp.constrainedBy] = env.appBase + '/constraints.html';
		res.links(links);
		next();
	});

	function get(req, res, includeBody) {
		res.set('Vary', 'Accept');
		console.log(req.headers.accept);
		db.get(req.fullURL, req.headers.accept, function(err, ires) {
			if (err) {
				console.log(err.stack);
				res.sendStatus(500);
				return;
			}

			if (ires.statusCode === 404) {
				res.sendStatus(404);
				return;
			}

			if (ires.statusCode === 410) {
				res.sendStatus(410);
				return;
			}

			if(!req.accepts([media.turtle, media.jsonld, media.json])){
				res.sendStatus(406);
				return;
			}

			var serialize;
			if(req.accepts(media.turtle)){
				serialize = turtle.serialize;
			}else{
				serialize = jsonld.serialize;
			}

			console.log("Body");
			console.log(typeof ires.body);

			serialize(JSON.parse(ires.body), function(err, content_type, doc){

				// add common response headers
				addHeaders(res, ires.body);
				//addHeaders(res, document);

				var preferenceApplied = hasPreferInclude(req, ldp.PreferMembership);

				if (preferenceApplied) {
					res.set('Preference-Applied', 'return=representation');
				}

				// generate an ETag for the content
				console.log(doc);
				var eTag = getETag(ires.body);
				if (req.get('If-None-Match') === eTag) {
					res.sendStatus(304);
					return;
				}

				res.writeHead(200, {
					'ETag': eTag,
					'Content-Type': 'application/ld+json'
				});
						
				if (includeBody) {
					res.end(new Buffer(doc), 'utf-8');
				} else {
					res.end();
				}

			});
			
		});
	}

	function post(req, res){

		console.log('POST ' + req.path);

		var parse, serialize, content_type;
		if (req.is(media.turtle)) {
			parse = turtle.parse;
			serialize = turtle.serialize;
			content_type = media.turtle;
		} else if (req.is(media.jsonld) || req.is(media.json)) {
			parse = jsonld.parse;
			serialize = jsonld.serialize;
			content_type = media.jsonld;
		} else {
			res.sendStatus(415);
			return;
		}

		db.get(req.fullURL, content_type, function(err, ires) {
			if (err) {
				console.log(err.stack);
				res.sendStatus(500);
				return;
			}

			var container = ires.body;

			if (!isContainer(container)) {
				res.set('Allow', 'GET,HEAD,PUT,DELETE,OPTIONS').sendStatus(405);
				return;
			}
			console.log("assign");
			assignURI(req.fullURL, req.get('Slug'), function(err, loc) {
				if (err) {
					console.log(err.stack);
					res.sendStatus(500);
					return;
				}
				
				parse(req, loc, function(err, triples) {
					
					if (err) {
						// allow the URI to be used again
						db.releaseURI(loc);
						res.sendStatus(400);
						return;
					}

					console.log("Triples");
					console.log(triples);

					triples = cleanTriples(triples);

					var document = {
						triples: triples
					};

					updateInteractionModel(document);
					addHeaders(res, document);

					// check if the client requested a specific interaction model through a Link header
					// if so, override what we found from the RDF content
					// FIXME: look for Link type=container as well
					if (hasResourceLink(req)) {
						document.interactionModel = ldp.RDFSource;
					}

					// check the membership triple pattern if this is a direct container
					if (!isMembershipPatternValid(document)) {
						db.releaseURI(loc);
						res.sendStatus(409);
						return;
					}

					// add the "inverse" isMemberOfRelation link if needed

					// DOUBLE CHECK - May need to alter the check for isMemberOfRelation
					if (container.includes(ldp.DirectContainer) &&
							container.includes(ldp.isMemberOfRelation)) {
						document.triples.push({
							subject: loc,
							predicate: ldp.isMemberOfRelation,
							object: req.fullURL
						});
					}

						if(err){
							console.log(err.stack);
							return;
						}

						// create the resource
						db.put(loc, triples, content_type, function(err, ires) {
							if (err) {
								console.log(err.stack);
								db.releaseURI(loc);
								res.sendStatus(500);
								return;
							}

							addToContainer(req, loc, container);

							res.location(loc).sendStatus(201);

						});
					
				});
			});
		});

	}

	resource.get(function(req, res, next) {
		console.log('GET ' + req.path);
		get(req, res, true);
	});

	resource.head(function(req, res, next) {
		console.log('HEAD ' + req.path);
		get(req, res, false);
	});

	function putUpdate(req, res, ires, serialize) {

		if (isContainer(ires.body)) {
			res.set('Allow', 'GET,HEAD,DELETE,OPTIONS,POST').sendStatus(405);
			return;
		}

		var content_type;

		if (req.is(media.turtle)) {
			content_type = media.turtle;
			parse = turtle.parse;
		} else if (req.is(media.jsonld) || req.is(media.json)) {
			content_type = media.jsonld;
			parse = jsonld.parse;
		} else {
			res.sendStatus(415);
			return;
		}

		var ifMatch = req.get('If-Match');
		if (!ifMatch) {
			res.sendStatus(428);
			return;
		}

		var eTag = getETag(req.body);
		if(ifMatch !== eTag){
			res.sendStatus(412);
			return;
		}

		parse(req, req.fullURI, function(err, doc){

			db.put(req.fullURI, doc, content_type, function(err) {
				if (err) {
					console.log(err.stack);
					res.sendStatus(500);
					return;
				}

				res.sendStatus(204);
			});

		});
	
	}

	resource.put(function(req, res, next) {
		console.log('PUT ' + req.path);

		var content_type, parse, serialize;
		
		if (req.is(media.turtle)) {
			parse = turtle.parse;
			serialize = turtle.serialize;
			content_type = 'text/turtle';
		} else if (req.is(media.jsonld) || req.is(media.json)) {
			parse = jsonld.parse;
			serialize = jsonld.serialize;
			content_type = 'application/ld+json';
		} else {
			res.sendStatus(415);
			return;
		}

		// get the resource to check if it exists and check its ETag
		db.get(req.fullURL, content_type, function(err, ires) {

			if (err) {
				console.log(err.stack);
				res.sendStatus(500);
			}

			if (ires.body) {
				putUpdate(req, res, ires, serialize);
			} else {
				post(req, res);
			}
		});
	
	});

	// More difficult to change because there are additional elements that have to change
	// That may not be identified yet
	resource.post(function(req, res, next) {
		console.log('POST ' + req.path);
		post(req, res);

	});

	function addToContainer(req, loc, container) {
		
		var parse, serialize;

		var content_type;

		if(req.is(media.turtle)){
			parse = turtle.parse;
			serialize = turtle.serialize;
			content_type = media.turtle;

		}else{
			parse = jsonld.parse;
			serialize = jsonld.serialize;
			content_type = media.jsonld;
		}

		req.rawBody = container;

		parse(req, req.fullURL, function(err, triples) {

			if(err){
				console.log(err.stack);
				return;
			}

			triples = cleanTriples(triples);

			triples.push({
				subject: req.fullURL,
				predicate: ldp.contains,
				object: loc
			});

			if(container.includes(ldp.DirectContainer)){
				var member_resource = "";
				var member_relation = "";
				for(var i = 0; i < triples.length; i++){
					if(triples[i].predicate = ldp.membershipResource){
						member_resource = triples[i].object;
					}

					if(triples[i].predicate = ldp.hasMemberRelation){
						member_relation = triples[i].object;
					}

				}

				if(member_relation !== "" && member_resource !== ""){
					addRelation(member_relation, member_resource, loc, parse, serialize, content_type);
				}

			}

			serialize(triples, function(err, content_type, result){

				db.put(req.fullURL, result, content_type, function(err, ires){
					if(err){
						console.log(err.stack);
						return;
					}

					console.log("Added to container");

				});

			});

		});

	}

	// addRelation needs to be fixed, include rawBody for ires
	function addRelation(relation, resource, loc, content_type){

		db.get(resource, content_type, function(err, ires){

			if(err){
				console.log(err.stack);
				return;
			}

			parse(ires, resource, function(err, triples){
				if(err){
					console.log(err.stack);
					return;
				}

				triples = cleanTriples(triples);

				triples.push({
					subject: resource,
					predicate: relation,
					object: loc
				});

				serialize(triples, function(err, content_type, result){
					db.put(resource, result, content_type, function(err, ires){
						if(err){
							console.log(err.stack);
							return;
						}

						console.log("Added relation");
					});
				});

			});

		});

	}

	resource.delete(function(req, res, next) {
		console.log('DELETE: ' + req.path);
		db.remove(req.fullURL, function(err, ires) {
			if (err) {
				console.log(err.stack);
				res.sendStatus(500);
				return;
			}

			deleteFromContainer(req);

			res.sendStatus(result.body ? 204 : 404);
		});
	});

	// Need to add in deletion from main resource, if this is a Direct Container
	function deleteFromContainer(req){

		// Want to find the container that has the resource and delete
		// The triple with the containment
		
		// What if there's only one resource in the container?
		// Has to delete the #contains triple as well

		var parse = turtle.parse;
		var serialize = turtle.serialize;

		var container_index = req.fullURL.lastIndexOf('/');

		var container_uri = req.fullURL.substring(0, container_index+1);

		db.get(container_uri, 'text/turtle', function(err, ires){

			if(err){
				console.log(err.stack);
				res.sendStatus(500);
				return;
			}

			if(!isContainer(ires.body)){
				console.log("Not a container");
				res.sendStatus(405);
				return;
			}

			req.rawBody = ires.body;

			parse(req, container_uri, function(err, triples){

				if(err){
					console.log(err.stack);
					return;
				}

				triples = cleanTriples(triples);

				var index = 0;
				for(var i = 0; i < triples.length; i++){
					console.log(triples[i].object + " " + req.fullURL);
					if(triples[i].object === req.fullURL.toLowerCase()){
						index = i;
						break;
					}
				}

				triples.splice(index, 1);

				if(container.includes(ldp.DirectContainer)){
					var member_resource = "";
					var member_relation = "";
					for(var i = 0; i < triples.length; i++){
						if(triples[i].predicate = ldp.membershipResource){
							member_resource = triples[i].object;
						}

						if(triples[i].predicate = ldp.hasMemberRelation){
							member_relation = triples[i].object;
						}

					}

					if(member_relation !== "" && member_resource !== ""){
						deleteRelation(member_relation, member_resource, req.fullURL, parse, serialize, content_type);
					}

				}

				serialize(triples, function(err, content_type, result){
					if(err){
						console.log(err.stack);
						return;
					}

					db.put(container_uri, result, content_type, function(err, ires){
						if(err){
							console.log(err.stack);
							res.sendStatus(500);
							return;
						}

						console.log("Deleted from container");
					});
				});
			});

		});

	};


	function deleteRelation(resource, loc, parse, serialize, content_type){

		db.get(resource, content_type, function(err, ires){

			if(err){
				console.log(err.stack);
				res.sendStatus(500);
				return;
			}

			parse(ires, resource, function(err, triples){
				if(err){
					console.log(err.stack);
					return;
				}

				triples = cleanTriples(triples);

				var index = 0;
				for(var i = 0; i < triples.length; i++){
					console.log(triples[i].object + " " + req.fullURL);
					if(triples[i].object === loc.toLowerCase()){
						index = i;
						break;
					}
				}

				triples.splice(index, 1);

				serialize(triples, function(err, content_type, result){

					if(err){
						console.log(err.stack);
						return;
					}

					db.put(resource, result, content_type, function(err, ires){
						if(err){
							console.log(err.stack);
							res.sendStatus(500);
							return;
						}

						console.log("Deleted relation");
					});
				});

			});

		});

	}

	resource.options(function(req, res, next) {
		db.get(req.fullURL, req.headers['Accept'], function(err, ires) {
			if (err) {
				console.log(err.stack);
				res.sendStatus(500);
				return;
			}

			if (ires.statusCode === 404) {
				res.sendStatus(404);
				return;
			}

			addHeaders(res, ires.body);
			res.sendStatus(200);
		});
	});


	// generate an ETag for a response using an MD5 hash
	// note: insert any calculated triples before calling getETag()
	function getETag(content) {
		return 'W/"' + crypto.createHash('md5').update(content).digest('hex') + '"';
	}

	// removes invalid unicode '\\' from parse() method executed in resource.post()
	function cleanTriples(triples){

		var substring_prefix = "";
		var substring_suffix = "";

		console.log("ORIGINAL TRIPLES");
		console.log(triples);

		triples.forEach(function(triple, index, triples){

			if(triple.subject.indexOf("\\") > -1){
				console.log("EXECUTED");
				if(triple.subject.indexOf("/\\") > -1){
					console.log("Executed 4");
					console.log(triple.subject);
					substring_prefix = triple.subject.substring(0, triple.subject.indexOf("\\")+2)
					substring_suffix = triple.subject.substring(triple.subject.indexOf("\\")+2, triple.subject.length)
					console.log(substring_suffix);

					if(substring_suffix.indexOf("\\")){
						substring_prefix = substring_prefix.replace("\\", "");
						substring_suffix = substring_suffix.replace(/\\/g, "/");
					}else{
						substring_prefix = substring_prefix.replace("\\\\", "");
						substring_suffix = substring_suffix.replace(/\\\\/g, "/");
					}
					console.log(substring_suffix);
					triple.subject = substring_prefix + substring_suffix;
					console.log(triple.subject);
				}else{
					console.log("EXECUTED 2");
					triple.subject = triple.subject.replace(/\\\\/g, "/");
					console.log("EXECUTED 3 " + triple.subject);
				}
			}

			if(triple.predicate.indexOf("\\") > -1){

				if(triple.predicate.indexOf("/\\") > -1){
					substring_prefix = triple.predicate.substring(0, triple.predicate.indexOf("\\")+2)
					substring_suffix = triple.predicate.substring(triple.predicate.indexOf("\\")+2, triple.predicate.length)
					if(substring_suffix.indexOf("\\")){
						substring_prefix = substring_prefix.replace("\\", "");
						substring_suffix = substring_suffix.replace(/\\/g, "/");
					}else{
						substring_prefix = substring_prefix.replace("\\\\", "");
						substring_suffix = substring_suffix.replace(/\\\\/g, "/");
					}
					triple.predicate = substring_prefix + substring_suffix;
				}else{
					triple.predicate = triple.predicate.replace(/\\\\/g, "/");
				}
			}

			if(triple.object.indexOf("\\") > -1){

				if(triple.object.indexOf("/\\") > -1){
					substring_prefix = triple.object.substring(0, triple.object.indexOf("\\")+2)
					substring_suffix = triple.object.substring(triple.object.indexOf("\\")+2, triple.object.length)
					if(substring_suffix.indexOf("\\")){
						substring_prefix = substring_prefix.replace("\\", "");
						substring_suffix = substring_suffix.replace(/\\/g, "/");
					}else{
						substring_prefix = substring_prefix.replace("\\\\", "");
						substring_suffix = substring_suffix.replace(/\\\\/g, "/");
					}
					triple.object = substring_prefix + substring_suffix;
				}else{
					triple.object = triple.object.replace(/\\\\/g, "/");
				}
			}
		});

		console.log("TRIPLES 2");
		console.log(triples);

		return triples;

	}

	// add common headers to all responses
	function addHeaders(res, document) {
		var allow = 'GET,HEAD,DELETE,OPTIONS';
		if (isContainer(document)) {
			if(typeof(document) === 'object'){
				res.links(
				{
					type: document.interactionModel
			
				});
			}else{
				res.links(
				{
					type: (document.includes(ldp.BasicContainer)) ? ldp.BasicContainer : ldp.DirectContainer
			
				});

			}
		
			allow += ',POST';
			res.set('Accept-Post', media.turtle + ',' + media.jsonld + ',' + media.json);
		} else {
			allow += ',PUT';
		}

		res.set('Allow', allow);
	}

	// checks if document represents a basic or direct container
	// this is set using document.interactionModel and can't be changed
	// we don't look at the RDF type
	function isContainer(document) {
		console.log(typeof(document));
		if(typeof(document) === 'object'){
			return document.interactionModel === ldp.BasicContainer || document.interactionModel === ldp.DirectContainer;
		}

		return document.includes(ldp.BasicContainer) || document.includes(ldp.DirectContainer);
	}

	// look at the triples to determine the type of container if this is a
	// container and, if a direct container, its membership pattern
	function updateInteractionModel(document) {
		var interactionModel = ldp.RDFSource;
		document.triples.forEach(function(triple) {
			var s = triple.subject,
				p = triple.predicate,
				o = triple.object;
			if (s !== document.name) {
				return;
			}

			// determine the interaction model from the RDF type
			// direct takes precedence if the resource has both direct and basic RDF types
			if (p === rdf.type && interactionModel !== ldp.DirectContainer && (o === ldp.BasicContainer || o === ldp.DirectContainer)) {
				interactionModel = o;
				return;
			}

			if (p === ldp.membershipResource) {
				document.membershipResource = o;
				return;
			}

			if (p === ldp.hasMemberRelation) {
				document.hasMemberRelation = o;
			}

			if (p === ldp.isMemberOfRelation) {
				document.isMemberOfRelation = o;
			}
		});

		// don't override an existing interaction model
		if (!document.interactionModel) {
			document.interactionModel = interactionModel;
		}
	}

	// append 'path' to the end of a uri
	// - any query or hash in the uri is removed
	// - any special characters like / and ? in 'path' are replaced
	function addPath(uri, path) {
		uri = uri.split("?")[0].split("#")[0];
		if (uri.substr(-1) !== '/') {
			uri += '/';
		}

		// remove special characters from the string (e.g., '/', '..', '?')
		var lastSegment = path.replace(/[^\w\s\-_]/gi, '');
		return uri + encodeURIComponent(lastSegment);
	}

	// generates and reserves a unique URI with base URI 'container'
	function uniqueURI(container, callback) {
		var candidate = addPath(container, 'res' + Date.now());
		console.log("reserve");
		db.reserveURI(candidate, function(err) {

			callback(err, candidate);
		});
	}

	// reserves a unique URI for a new subApp. will use slug if available,
	// but falls back to the usual naming scheme if slug is already used
	function assignURI(container, slug, callback) {

		if (slug) {
			var candidate = addPath(container, slug);
			
			db.reserveURI(candidate, function(err) {
				console.log("reserve");
				if (err) {
					uniqueURI(container, callback);
				} else {
					callback(null, candidate);
				}
			});
		} else {
			console.log("Unique");
			uniqueURI(container, callback);
		}
	}

	// look for a Link request header indicating the entity uses a ldp:Resource
	// interaction model rather than container
	function hasResourceLink(req) {
		var link = req.get('Link');
		// look for links like
		//	 <http://www.w3.org/ns/ldp#Resource>; rel="type"
		// these are also valid
		//	 <http://www.w3.org/ns/ldp#Resource>;rel=type
		//	 <http://www.w3.org/ns/ldp#Resource>; rel="type http://example.net/relation/other"
		return link &&
			/<http:\/\/www\.w3\.org\/ns\/ldp#Resource\>\s*;\s*rel\s*=\s*(("\s*([^"]+\s+)*type(\s+[^"]+)*\s*")|\s*type[\s,;$])/
			.test(link);
	}

	function hasPreferInclude(req, inclusion) {
		return hasPrefer(req, 'include', inclusion);
	}

	function hasPreferOmit(req, omission) {
		return hasPrefer(req, 'omit', omission);
	}

	function hasPrefer(req, token, parameter) {
		if (!req) {
			return false;
		}

		var preferHeader = req.get('Prefer');
		if (!preferHeader) {
			return false;
		}

		// from the LDP prefer parameters, the only charcter we need to escape
		// for regular expressions is '.'
		// https://dvcs.w3.org/hg/ldpwg/raw-file/default/ldp.html#prefer-parameters
		var word = parameter.replace(/\./g, '\\.');

		// construct a regex that matches the preference
		var regex =
		   	new RegExp(token + '\\s*=\\s*("\\s*([^"]+\\s+)*' + word + '(\\s+[^"]+)*\\s*"|' + word + '$)');
		return regex.test(preferHeader);
	}

	// check the consistency of the membership triple pattern if this is a direct container
	function isMembershipPatternValid(document) {
		if (document.interactionModel !== ldp.DirectContainer) {
			// not a direct container, nothing to do
			return true;
		}

		// must have a membership resouce
		if (!document.membershipResource) {
			return false;
		}

		// must have hasMemberRelation or isMemberOfRelation, but can't have both
		if (document.hasMemberRelation) {
			return !document.isMemberOfRelation;
		}
		if (document.isMemberOfRelation) {
			return !document.hasMemberRelation;
		}

		// no membership triple pattern
		return false;
	}
	return subApp;
}


module.exports = function(env) {
	appBase = env.appBase;
	var db = require('./db.js');
	module.exports.db = db; // allow the database to be used by other middleware
	console.log("INIT");
	db.init(env, function(err) {
		if (err) {
			console.error(err);
			console.error("Can't initialize Jena.");
			return;
		}

		// create root container if it doesn't exist
		console.log("LDP INIT");
		// create root container if it doesn't exist
		db.get(env.ldpBase, "", function(err, document) {
			console.log(document.statusCode);
			if (err) {
				console.log(err.stack);
				return;
			}
			
			if (document.statusCode === 404) {
				createRootContainer(function(err) {
					if (err) {
						console.log(err.stack);
					}
				});
			}
		});
		
	});
	return ldpRoutes(db, env);

	function createRootContainer(callback) {

		var triples = [{
			subject: env.ldpBase,
			predicate: rdf.type,
			object: ldp.RDFSource
		}, {
			subject: env.ldpBase,
			predicate: rdf.type,
			object: ldp.Container
		}, {
			subject: env.ldpBase,
			predicate: rdf.type,
			object: ldp.BasicContainer
		}, {
			subject: env.ldpBase,
			predicate: 'http://purl.org/dc/terms/title',
			object: '"LDP.js root container"'
		}];

		console.log("BASE CONTAINER " + env.ldpBase);


		db.put(env.ldpBase, triples, "", callback);
	}

}



/*

{
  "@graph" : [ {
    "@id" : "",
    "@type" : "foaf:Person",
    "name" : "David Banner",
    "workplaceHomepage" : "http://www.gamma-rays-r-us.com"
  } ],
  "@id" : "urn:x-arq:DefaultGraphNode",
  "@context" : {
    "name" : "http://xmlns.com/foaf/0.1/name",
    "workplaceHomepage" : {
      "@id" : "http://xmlns.com/foaf/0.1/workplaceHomepage",
      "@type" : "@id"
    },
    "rdf" : "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "foaf" : "http://xmlns.com/foaf/0.1/"
  }
}

*/