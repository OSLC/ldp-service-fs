# ldp-service-jena

A simple Node.js module providing Express middleware to create a [W3C Linked Data Platform](http://www.w3.org/2012/ldp) server. The service uses Apache Jena Fuseki for persistence, jsonld.js for JSON-LD support, and a few other JavaScript libraries.  A sample app using the LDP middleware service is running at [http://ldp-app.mybluemix.net](http://ldp-app.mybluemix.net).

ldp-service-jena supports LDP basic and direct containers. Indirect
containers and non-RDF source are not implemented.

Many thanks to Steve Speicher and Sam Padgett for their valuable contribution to LDP and this LDP middleware.

Module planning, maintenance and issues can be see at at the [ldp-service](https://hub.jazz.net/project/jamsden/ldp-service/overview) IBM Bluemix DevOps Services project.


## Using

1) Install the required modules

Install [Node.js](http://nodejs.org). 

Start [Jena](https://jena.apache.org/download/index.cgi). Download apache-jena-fuseki-2.4.1.tar.gz under Apache Jena Fuseki and unzip it.

To run Jena, enter the following code

	$ fuseki-server --mem /ldp

/ldp is a datastore that allows the request to access the resources on the db. It can be named in any other way. --mem allows for temporary storage of data
for that instant. For the data to permantently store data (and to update data), the following code should be ran.

	$ fuseki-server --update --loc=<path to db> /ldp

--update allows the user to update resources, while --loc tells the location of the stored items for persistence.

Install express.js and create a sample express app

	$ npm install express -g
	$ express --git -e <appDir>

2) Edit app.js and add whatever Express middleware you need including ldp-service. ldp-service-jena also provides access to its Apache Jena database in case additional middleware needs direct access to the database. ldp-service-jena has not been published to npm yet, so it will need to be access locally.

	var ldpService = require('./ldp-service-jena');
	app.use(ldpService());
	var db = ldpService.db; // incase further middleware needs access to the database

3) Configuration defaults can be found in config.json. These may be overridden by variables in the environment, including Bluemix variables if deployed in a Bluemix app.

4) To start the app, run these commands

    $ npm install
    $ node app.js

Finally, point your browser to
[http://localhost:3000/](http://localhost:3000/).


## Differences From 'ldp-service'

ldp-service-jena has not been configured to use the visualization tool that was included in ldp-service. Any testing will need to be done through a
third-party program.

The file db.js uses the 'request' package from npm to perform HTTP requests on Apache Jena Fuseki. It does not directly connect with the database. Rather, it
finds the location of the Apache Jena db instance using the URI in the configuration.

The code does not have its own resources to upload if there is no root in the database. It loads local 'default services' that are located in the configuration
file. This is a recursive operation at loads all resources with new URI's. It assumes that the default services are written in JSON-LD.


## Example of a Configuration File

ldp-service-jena assumes that the configuration file is written with a certain set of properties. Here is an example.

{
	"scheme": "http",
	"host": "localhost",
	"port": 3000,
	"context": "/r",
	"JenaURL": "http://localhost:3030/ldp/",
	"services": *path to* "./config/defaultServices.json"
}


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
