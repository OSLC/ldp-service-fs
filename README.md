# ldp-service-fs

[![Discourse status](https://img.shields.io/discourse/https/meta.discourse.org/status.svg)](https://forum.open-services.net/)
[![Gitter](https://img.shields.io/gitter/room/nwjs/nw.js.svg)](https://gitter.im/OSLC/chat)

A simple Node.js module providing Express middleware to create a [W3C Linked Data Platform](http://www.w3.org/2012/ldp) server. The service writes data to a local file for persistence, jsonld.js for JSON-LD support, and a few other JavaScript libraries.  A sample app using the LDP middleware service is running at [http://ldp-app.mybluemix.net](http://ldp-app.mybluemix.net).

ldp-service-fs supports LDP basic and direct containers. Indirect
containers and non-RDF source are not implemented.

Many thanks to Steve Speicher and Sam Padgett for their valuable contribution to LDP and this LDP middleware.


## Using

1) Install the required modules

Install [Node.js](http://nodejs.org). 

The service writes data to a local file. This data is written as a series of subject, predicate, object triples.

Install express.js and create a sample express app

	$ npm install express -g
	$ express --git -e <appDir>

2) Edit app.js and add whatever Express middleware you need including ldp-service. ldp-service-jena also provides access to its Apache Jena database in case additional middleware needs direct access to the database. ldp-service-jena has not been published to npm yet, so it will need to be access locally.

	var ldpService = require('./ldp-service-jena');
	app.use(ldpService());
	var db = ldpService.db; // incase further middleware needs access to the database

3) Configuration defaults can be found in config.json. These may be overridden by variables in the environment, including Bluemix variables if deployed in a Bluemix app.

4) To start the app, run these commands. Currently, this service has been tested with the ldp-app.

    $ npm install
    $ node app.js

Finally, point your browser to
[http://localhost:3000/](http://localhost:3000/).


## Example of a Configuration File

ldp-service-fs assumes that the configuration file is written with a certain set of properties. Here is an example.

var path = require('path');

{
	"scheme": "http",
	"host": "localhost",
	"port": 3000,
	"context": "/r",
	"URL": "/data/rdf.json"
}

The URL is the file that the data is written to. Be sure that in ldp-app's config.js file that URL is an exported property.

## License

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
