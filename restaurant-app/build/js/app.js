if (navigator.serviceWorker) {
	navigator.serviceWorker.register('/sw.js').then(function() {
		console.log('Worker registered!');
	}).catch(function(err) {
		console.log(err);
	});
}

'use strict';

(function() {
	function toArray(arr) {
		return Array.prototype.slice.call(arr);
	}

	function promisifyRequest(request) {
		return new Promise(function(resolve, reject) {
			request.onsuccess = function() {
				resolve(request.result);
			};

			request.onerror = function() {
				reject(request.error);
			};
		});
	}

	function promisifyRequestCall(obj, method, args) {
		var request;
		var p = new Promise(function(resolve, reject) {
			request = obj[method].apply(obj, args);
			promisifyRequest(request).then(resolve, reject);
		});

		p.request = request;
		return p;
	}

	function promisifyCursorRequestCall(obj, method, args) {
		var p = promisifyRequestCall(obj, method, args);
		return p.then(function(value) {
			if (!value) return;
			return new Cursor(value, p.request);
		});
	}

	function proxyProperties(ProxyClass, targetProp, properties) {
		properties.forEach(function(prop) {
			Object.defineProperty(ProxyClass.prototype, prop, {
				get: function() {
					return this[targetProp][prop];
				},
				set: function(val) {
					this[targetProp][prop] = val;
				}
			});
		});
	}

	function proxyRequestMethods(ProxyClass, targetProp, Constructor, properties) {
		properties.forEach(function(prop) {
			if (!(prop in Constructor.prototype)) return;
			ProxyClass.prototype[prop] = function() {
				return promisifyRequestCall(this[targetProp], prop, arguments);
			};
		});
	}

	function proxyMethods(ProxyClass, targetProp, Constructor, properties) {
		properties.forEach(function(prop) {
			if (!(prop in Constructor.prototype)) return;
			ProxyClass.prototype[prop] = function() {
				return this[targetProp][prop].apply(this[targetProp], arguments);
			};
		});
	}

	function proxyCursorRequestMethods(ProxyClass, targetProp, Constructor, properties) {
		properties.forEach(function(prop) {
			if (!(prop in Constructor.prototype)) return;
			ProxyClass.prototype[prop] = function() {
				return promisifyCursorRequestCall(this[targetProp], prop, arguments);
			};
		});
	}

	function Index(index) {
		this._index = index;
	}

	proxyProperties(Index, '_index', [
		'name',
		'keyPath',
		'multiEntry',
		'unique'
	]);

	proxyRequestMethods(Index, '_index', IDBIndex, [
		'get',
		'getKey',
		'getAll',
		'getAllKeys',
		'count'
	]);

	proxyCursorRequestMethods(Index, '_index', IDBIndex, [
		'openCursor',
		'openKeyCursor'
	]);

	function Cursor(cursor, request) {
		this._cursor = cursor;
		this._request = request;
	}

	proxyProperties(Cursor, '_cursor', [
		'direction',
		'key',
		'primaryKey',
		'value'
	]);

	proxyRequestMethods(Cursor, '_cursor', IDBCursor, [
		'update',
		'delete'
	]);

	// proxy 'next' methods
	['advance', 'continue', 'continuePrimaryKey'].forEach(function(methodName) {
		if (!(methodName in IDBCursor.prototype)) return;
		Cursor.prototype[methodName] = function() {
			var cursor = this;
			var args = arguments;
			return Promise.resolve().then(function() {
				cursor._cursor[methodName].apply(cursor._cursor, args);
				return promisifyRequest(cursor._request).then(function(value) {
					if (!value) return;
					return new Cursor(value, cursor._request);
				});
			});
		};
	});

	function ObjectStore(store) {
		this._store = store;
	}

	ObjectStore.prototype.createIndex = function() {
		return new Index(this._store.createIndex.apply(this._store, arguments));
	};

	ObjectStore.prototype.index = function() {
		return new Index(this._store.index.apply(this._store, arguments));
	};

	proxyProperties(ObjectStore, '_store', [
		'name',
		'keyPath',
		'indexNames',
		'autoIncrement'
	]);

	proxyRequestMethods(ObjectStore, '_store', IDBObjectStore, [
		'put',
		'add',
		'delete',
		'clear',
		'get',
		'getAll',
		'getKey',
		'getAllKeys',
		'count'
	]);

	proxyCursorRequestMethods(ObjectStore, '_store', IDBObjectStore, [
		'openCursor',
		'openKeyCursor'
	]);

	proxyMethods(ObjectStore, '_store', IDBObjectStore, [
		'deleteIndex'
	]);

	function Transaction(idbTransaction) {
		this._tx = idbTransaction;
		this.complete = new Promise(function(resolve, reject) {
			idbTransaction.oncomplete = function() {
				resolve();
			};
			idbTransaction.onerror = function() {
				reject(idbTransaction.error);
			};
			idbTransaction.onabort = function() {
				reject(idbTransaction.error);
			};
		});
	}

	Transaction.prototype.objectStore = function() {
		return new ObjectStore(this._tx.objectStore.apply(this._tx, arguments));
	};

	proxyProperties(Transaction, '_tx', [
		'objectStoreNames',
		'mode'
	]);

	proxyMethods(Transaction, '_tx', IDBTransaction, [
		'abort'
	]);

	function UpgradeDB(db, oldVersion, transaction) {
		this._db = db;
		this.oldVersion = oldVersion;
		this.transaction = new Transaction(transaction);
	}

	UpgradeDB.prototype.createObjectStore = function() {
		return new ObjectStore(this._db.createObjectStore.apply(this._db, arguments));
	};

	proxyProperties(UpgradeDB, '_db', [
		'name',
		'version',
		'objectStoreNames'
	]);

	proxyMethods(UpgradeDB, '_db', IDBDatabase, [
		'deleteObjectStore',
		'close'
	]);

	function DB(db) {
		this._db = db;
	}

	DB.prototype.transaction = function() {
		return new Transaction(this._db.transaction.apply(this._db, arguments));
	};

	proxyProperties(DB, '_db', [
		'name',
		'version',
		'objectStoreNames'
	]);

	proxyMethods(DB, '_db', IDBDatabase, [
		'close'
	]);

	// Add cursor iterators
	// TODO: remove this once browsers do the right thing with promises
	['openCursor', 'openKeyCursor'].forEach(function(funcName) {
		[ObjectStore, Index].forEach(function(Constructor) {
			// Don't create iterateKeyCursor if openKeyCursor doesn't exist.
			if (!(funcName in Constructor.prototype)) return;

			Constructor.prototype[funcName.replace('open', 'iterate')] = function() {
				var args = toArray(arguments);
				var callback = args[args.length - 1];
				var nativeObject = this._store || this._index;
				var request = nativeObject[funcName].apply(nativeObject, args.slice(0, -1));
				request.onsuccess = function() {
					callback(request.result);
				};
			};
		});
	});

	// polyfill getAll
	[Index, ObjectStore].forEach(function(Constructor) {
		if (Constructor.prototype.getAll) return;
		Constructor.prototype.getAll = function(query, count) {
			var instance = this;
			var items = [];

			return new Promise(function(resolve) {
				instance.iterateCursor(query, function(cursor) {
					if (!cursor) {
						resolve(items);
						return;
					}
					items.push(cursor.value);

					if (count !== undefined && items.length == count) {
						resolve(items);
						return;
					}
					cursor.continue();
				});
			});
		};
	});

	var exp = {
		open: function(name, version, upgradeCallback) {
			var p = promisifyRequestCall(indexedDB, 'open', [name, version]);
			var request = p.request;

			if (request) {
				request.onupgradeneeded = function(event) {
					if (upgradeCallback) {
						upgradeCallback(new UpgradeDB(request.result, event.oldVersion, request.transaction));
					}
				};
			}

			return p.then(function(db) {
				return new DB(db);
			});
		},
		delete: function(name) {
			return promisifyRequestCall(indexedDB, 'deleteDatabase', [name]);
		}
	};

	if (typeof module !== 'undefined') {
		module.exports = exp;
		module.exports.default = module.exports;
	}
	else {
		self.idb = exp;
	}
}());

var API_URL = 'http://localhost:1337/restaurants';
var fetchStatus = 0;

// Helper Functions for various IDb Operations
class IDbOperationsHelper {
	static checkForIDbSupport() {
		if (!('indexedDB' in window)) {
			return 0;
		} else {
			return 1;
		}
	}

	static openIDb(name, version, objectStoreName) {
		var dbPromise = idb.open(name, version, upgradeDB => {
			upgradeDB.createObjectStore(objectStoreName, { autoIncrement: true });
		});
		return dbPromise;
	}

	static addToDb(dbPromise, objectStoreName, permision, jsonData) {
		dbPromise.then(db => {
			var transact = db.transaction(objectStoreName, permision);
			//Add all the json content here
			transact.objectStore(objectStoreName).put(jsonData);
			return transact.complete;
		}).then(response => {
			console.log('Restaurant saved to IDb');
		});
	}

	static getAllData(dbPromise, transactionName, objectStoreName) {
		var responseArrayPromise = dbPromise.then(db => db
			.transaction(transactionName)
			.objectStore(objectStoreName)
			.getAll()
		);
		responseArrayPromise.then(arry => {
			IDbOperationsHelper.setRestaurantsData(arry);
		});
	}

	static getRestaurantsFromServer(dbPromise, objectStoreName, permision, callback) {
		fetch(API_URL)
			.then(response => response.json())
			.then(responseJson => {
				responseJson.forEach(restaurant => {
					restaurant = IDbOperationsHelper.addMissingData(restaurant);
				});

				if (fetchStatus != 1) {
					fetchStatus = 1;
					responseJson.forEach(restaurantData => {

						//Add every single restaurant data to IDb
						IDbOperationsHelper.addToDb(
							dbPromise,
							objectStoreName,
							permision,
							restaurantData
						);
					});
				}

				console.log(responseJson);
				callback (null, responseJson);
			}).catch(error => {
				console.log(`Unable to fetch restaurants, Error: ${error}`);
				callback (error, null);
			});
	}

	static getRestaurantsData(callback) {
		var idbName = 'restaurants-data';
		var dbVersion = 1;
		var objectStoreNameString = 'restaurants';
		var transactionNameString = 'restaurants';
		var dbPermission = 'readwrite';

		var dbPromise = IDbOperationsHelper.openIDb(
			idbName,
			dbVersion,
			objectStoreNameString
		);

		dbPromise.then(db =>
			db.transaction(transactionNameString)
				.objectStore(objectStoreNameString)
				.getAll()
		).then(responseObejcts => {
			if (responseObejcts.length <= 0) {
				IDbOperationsHelper.getRestaurantsFromServer(
					dbPromise,
					objectStoreNameString,
					dbPermission,
					callback
				);
			} else {
				callback(null, responseObejcts);
			}
		});
	}

	// Handle for last entry on Restaurants List
	static addMissingData(restJson) {
		if (!isNaN(restJson.photograph)) {
			restJson.photograph = restJson.photograph + '.jpg';
		} else {
			restJson['photograph'] = restJson.id + '.jpg';
		}
		return restJson;
	}
}

// Common database helper functions.
class DBHelper {
	static get NEW_URL() {
		return 'http://localhost:1337/restaurants';
	}
	/**
     * Fetch a restaurant by its ID.
     */
	static fetchRestaurantById(id, callback) {
		// fetch all restaurants with proper error handling.
		IDbOperationsHelper.getRestaurantsData((error, restaurants) => {
			if (error) {
				callback(error, null);
			} else {
				const restaurant = restaurants.find(r => r.id == id);
				if (restaurant) {
					// Got the restaurant
					callback(null, restaurant);
				} else {
					// Restaurant does not exist in the database
					callback('Restaurant does not exist', null);
				}
			}
		});
	}

	/**
     * Fetch restaurants by a cuisine type with proper error handling.
     */
	static fetchRestaurantByCuisine(cuisine, callback) {
		// Fetch all restaurants  with proper error handling
		IDbOperationsHelper.getRestaurantsData((error, restaurants) => {
			if (error) {
				callback(error, null);
			} else {
				// Filter restaurants to have only given cuisine type
				const results = restaurants.filter(r => r.cuisine_type == cuisine);
				callback(null, results);
			}
		});
	}

	/**
     * Fetch restaurants by a neighborhood with proper error handling.
     */
	static fetchRestaurantByNeighborhood(neighborhood, callback) {
		// Fetch all restaurants
		IDbOperationsHelper.getRestaurantsData((error, restaurants) => {
			if (error) {
				callback(error, null);
			} else {
				// Filter restaurants to have only given neighborhood
				const results = restaurants.filter(r => r.neighborhood == neighborhood);
				callback(null, results);
			}
		});
	}

	/**
     * Fetch restaurants by a cuisine and a neighborhood with proper error handling.
     */
	static fetchRestaurantByCuisineAndNeighborhood(
		cuisine,
		neighborhood,
		callback
	) {
		// Fetch all restaurants
		IDbOperationsHelper.getRestaurantsData((error, restaurants) => {
			if (error) {
				callback(error, null);
			} else {
				let results = restaurants;
				if (cuisine != 'all') {
					// filter by cuisine
					results = results.filter(r => r.cuisine_type == cuisine);
				}
				if (neighborhood != 'all') {
					// filter by neighborhood
					results = results.filter(r => r.neighborhood == neighborhood);
				}
				callback(null, results);
			}
		});
	}

	/**
     * Fetch all neighborhoods with proper error handling.
     */
	static fetchNeighborhoods(callback) {
		// Fetch all restaurants
		IDbOperationsHelper.getRestaurantsData((error, restaurants) => {
			if (error) {
				callback(error, null);
			} else {
				// Get all neighborhoods from all restaurants
				const neighborhoods = restaurants.map(
					(v, i) => restaurants[i].neighborhood
				);
				// Remove duplicates from neighborhoods
				const uniqueNeighborhoods = neighborhoods.filter(
					(v, i) => neighborhoods.indexOf(v) == i
				);
				callback(null, uniqueNeighborhoods);
			}
		});
	}

	/**
     * Fetch all cuisines with proper error handling.
     */
	static fetchCuisines(callback) {
		// Fetch all restaurants
		IDbOperationsHelper.getRestaurantsData((error, restaurants) => {
			if (error) {
				callback(error, null);
			} else {
				// Get all cuisines from all restaurants
				const cuisines = restaurants.map((v, i) => restaurants[i].cuisine_type);
				// Remove duplicates from cuisines
				const uniqueCuisines = cuisines.filter(
					(v, i) => cuisines.indexOf(v) == i
				);
				callback(null, uniqueCuisines);
			}
		});
	}

	/**
     * Restaurant page URL.
     */
	static urlForRestaurant(restaurant) {
		return `./restaurant.html?id=${restaurant.id}`;
	}

	/**
     * Restaurant image URL.
     */
	static imageUrlForRestaurant(restaurant) {
		return `/img/${restaurant.photograph}`;
	}

	/**
     * Map marker for a restaurant.
     */
	static mapMarkerForRestaurant(restaurant, map) {
		const marker = new L.marker(
			[restaurant.latlng.lat, restaurant.latlng.lng],
			{
				title: restaurant.name,
				alt: restaurant.name,
				url: DBHelper.urlForRestaurant(restaurant)
			}
		);
		marker.addTo(newMap);
		return marker;
	}
}

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImluZGV4Q29udHJvbGxlci5qcyIsImlkYi5qcyIsIklEYk9wZXJhdGlvbnNIZWxwZXIuanMiLCJkYmhlbHBlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQzVUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUNqSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJhcHAuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpZiAobmF2aWdhdG9yLnNlcnZpY2VXb3JrZXIpIHtcblx0bmF2aWdhdG9yLnNlcnZpY2VXb3JrZXIucmVnaXN0ZXIoJy9zdy5qcycpLnRoZW4oZnVuY3Rpb24oKSB7XG5cdFx0Y29uc29sZS5sb2coJ1dvcmtlciByZWdpc3RlcmVkIScpO1xuXHR9KS5jYXRjaChmdW5jdGlvbihlcnIpIHtcblx0XHRjb25zb2xlLmxvZyhlcnIpO1xuXHR9KTtcbn1cbiIsIid1c2Ugc3RyaWN0JztcblxuKGZ1bmN0aW9uKCkge1xuXHRmdW5jdGlvbiB0b0FycmF5KGFycikge1xuXHRcdHJldHVybiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcnIpO1xuXHR9XG5cblx0ZnVuY3Rpb24gcHJvbWlzaWZ5UmVxdWVzdChyZXF1ZXN0KSB7XG5cdFx0cmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuXHRcdFx0cmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmVzb2x2ZShyZXF1ZXN0LnJlc3VsdCk7XG5cdFx0XHR9O1xuXG5cdFx0XHRyZXF1ZXN0Lm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmVqZWN0KHJlcXVlc3QuZXJyb3IpO1xuXHRcdFx0fTtcblx0XHR9KTtcblx0fVxuXG5cdGZ1bmN0aW9uIHByb21pc2lmeVJlcXVlc3RDYWxsKG9iaiwgbWV0aG9kLCBhcmdzKSB7XG5cdFx0dmFyIHJlcXVlc3Q7XG5cdFx0dmFyIHAgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcblx0XHRcdHJlcXVlc3QgPSBvYmpbbWV0aG9kXS5hcHBseShvYmosIGFyZ3MpO1xuXHRcdFx0cHJvbWlzaWZ5UmVxdWVzdChyZXF1ZXN0KS50aGVuKHJlc29sdmUsIHJlamVjdCk7XG5cdFx0fSk7XG5cblx0XHRwLnJlcXVlc3QgPSByZXF1ZXN0O1xuXHRcdHJldHVybiBwO1xuXHR9XG5cblx0ZnVuY3Rpb24gcHJvbWlzaWZ5Q3Vyc29yUmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpIHtcblx0XHR2YXIgcCA9IHByb21pc2lmeVJlcXVlc3RDYWxsKG9iaiwgbWV0aG9kLCBhcmdzKTtcblx0XHRyZXR1cm4gcC50aGVuKGZ1bmN0aW9uKHZhbHVlKSB7XG5cdFx0XHRpZiAoIXZhbHVlKSByZXR1cm47XG5cdFx0XHRyZXR1cm4gbmV3IEN1cnNvcih2YWx1ZSwgcC5yZXF1ZXN0KTtcblx0XHR9KTtcblx0fVxuXG5cdGZ1bmN0aW9uIHByb3h5UHJvcGVydGllcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBwcm9wZXJ0aWVzKSB7XG5cdFx0cHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcblx0XHRcdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShQcm94eUNsYXNzLnByb3RvdHlwZSwgcHJvcCwge1xuXHRcdFx0XHRnZXQ6IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRcdHJldHVybiB0aGlzW3RhcmdldFByb3BdW3Byb3BdO1xuXHRcdFx0XHR9LFxuXHRcdFx0XHRzZXQ6IGZ1bmN0aW9uKHZhbCkge1xuXHRcdFx0XHRcdHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF0gPSB2YWw7XG5cdFx0XHRcdH1cblx0XHRcdH0pO1xuXHRcdH0pO1xuXHR9XG5cblx0ZnVuY3Rpb24gcHJveHlSZXF1ZXN0TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuXHRcdHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG5cdFx0XHRpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcblx0XHRcdFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJldHVybiBwcm9taXNpZnlSZXF1ZXN0Q2FsbCh0aGlzW3RhcmdldFByb3BdLCBwcm9wLCBhcmd1bWVudHMpO1xuXHRcdFx0fTtcblx0XHR9KTtcblx0fVxuXG5cdGZ1bmN0aW9uIHByb3h5TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuXHRcdHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG5cdFx0XHRpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcblx0XHRcdFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJldHVybiB0aGlzW3RhcmdldFByb3BdW3Byb3BdLmFwcGx5KHRoaXNbdGFyZ2V0UHJvcF0sIGFyZ3VtZW50cyk7XG5cdFx0XHR9O1xuXHRcdH0pO1xuXHR9XG5cblx0ZnVuY3Rpb24gcHJveHlDdXJzb3JSZXF1ZXN0TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuXHRcdHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG5cdFx0XHRpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcblx0XHRcdFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJldHVybiBwcm9taXNpZnlDdXJzb3JSZXF1ZXN0Q2FsbCh0aGlzW3RhcmdldFByb3BdLCBwcm9wLCBhcmd1bWVudHMpO1xuXHRcdFx0fTtcblx0XHR9KTtcblx0fVxuXG5cdGZ1bmN0aW9uIEluZGV4KGluZGV4KSB7XG5cdFx0dGhpcy5faW5kZXggPSBpbmRleDtcblx0fVxuXG5cdHByb3h5UHJvcGVydGllcyhJbmRleCwgJ19pbmRleCcsIFtcblx0XHQnbmFtZScsXG5cdFx0J2tleVBhdGgnLFxuXHRcdCdtdWx0aUVudHJ5Jyxcblx0XHQndW5pcXVlJ1xuXHRdKTtcblxuXHRwcm94eVJlcXVlc3RNZXRob2RzKEluZGV4LCAnX2luZGV4JywgSURCSW5kZXgsIFtcblx0XHQnZ2V0Jyxcblx0XHQnZ2V0S2V5Jyxcblx0XHQnZ2V0QWxsJyxcblx0XHQnZ2V0QWxsS2V5cycsXG5cdFx0J2NvdW50J1xuXHRdKTtcblxuXHRwcm94eUN1cnNvclJlcXVlc3RNZXRob2RzKEluZGV4LCAnX2luZGV4JywgSURCSW5kZXgsIFtcblx0XHQnb3BlbkN1cnNvcicsXG5cdFx0J29wZW5LZXlDdXJzb3InXG5cdF0pO1xuXG5cdGZ1bmN0aW9uIEN1cnNvcihjdXJzb3IsIHJlcXVlc3QpIHtcblx0XHR0aGlzLl9jdXJzb3IgPSBjdXJzb3I7XG5cdFx0dGhpcy5fcmVxdWVzdCA9IHJlcXVlc3Q7XG5cdH1cblxuXHRwcm94eVByb3BlcnRpZXMoQ3Vyc29yLCAnX2N1cnNvcicsIFtcblx0XHQnZGlyZWN0aW9uJyxcblx0XHQna2V5Jyxcblx0XHQncHJpbWFyeUtleScsXG5cdFx0J3ZhbHVlJ1xuXHRdKTtcblxuXHRwcm94eVJlcXVlc3RNZXRob2RzKEN1cnNvciwgJ19jdXJzb3InLCBJREJDdXJzb3IsIFtcblx0XHQndXBkYXRlJyxcblx0XHQnZGVsZXRlJ1xuXHRdKTtcblxuXHQvLyBwcm94eSAnbmV4dCcgbWV0aG9kc1xuXHRbJ2FkdmFuY2UnLCAnY29udGludWUnLCAnY29udGludWVQcmltYXJ5S2V5J10uZm9yRWFjaChmdW5jdGlvbihtZXRob2ROYW1lKSB7XG5cdFx0aWYgKCEobWV0aG9kTmFtZSBpbiBJREJDdXJzb3IucHJvdG90eXBlKSkgcmV0dXJuO1xuXHRcdEN1cnNvci5wcm90b3R5cGVbbWV0aG9kTmFtZV0gPSBmdW5jdGlvbigpIHtcblx0XHRcdHZhciBjdXJzb3IgPSB0aGlzO1xuXHRcdFx0dmFyIGFyZ3MgPSBhcmd1bWVudHM7XG5cdFx0XHRyZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbihmdW5jdGlvbigpIHtcblx0XHRcdFx0Y3Vyc29yLl9jdXJzb3JbbWV0aG9kTmFtZV0uYXBwbHkoY3Vyc29yLl9jdXJzb3IsIGFyZ3MpO1xuXHRcdFx0XHRyZXR1cm4gcHJvbWlzaWZ5UmVxdWVzdChjdXJzb3IuX3JlcXVlc3QpLnRoZW4oZnVuY3Rpb24odmFsdWUpIHtcblx0XHRcdFx0XHRpZiAoIXZhbHVlKSByZXR1cm47XG5cdFx0XHRcdFx0cmV0dXJuIG5ldyBDdXJzb3IodmFsdWUsIGN1cnNvci5fcmVxdWVzdCk7XG5cdFx0XHRcdH0pO1xuXHRcdFx0fSk7XG5cdFx0fTtcblx0fSk7XG5cblx0ZnVuY3Rpb24gT2JqZWN0U3RvcmUoc3RvcmUpIHtcblx0XHR0aGlzLl9zdG9yZSA9IHN0b3JlO1xuXHR9XG5cblx0T2JqZWN0U3RvcmUucHJvdG90eXBlLmNyZWF0ZUluZGV4ID0gZnVuY3Rpb24oKSB7XG5cdFx0cmV0dXJuIG5ldyBJbmRleCh0aGlzLl9zdG9yZS5jcmVhdGVJbmRleC5hcHBseSh0aGlzLl9zdG9yZSwgYXJndW1lbnRzKSk7XG5cdH07XG5cblx0T2JqZWN0U3RvcmUucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24oKSB7XG5cdFx0cmV0dXJuIG5ldyBJbmRleCh0aGlzLl9zdG9yZS5pbmRleC5hcHBseSh0aGlzLl9zdG9yZSwgYXJndW1lbnRzKSk7XG5cdH07XG5cblx0cHJveHlQcm9wZXJ0aWVzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgW1xuXHRcdCduYW1lJyxcblx0XHQna2V5UGF0aCcsXG5cdFx0J2luZGV4TmFtZXMnLFxuXHRcdCdhdXRvSW5jcmVtZW50J1xuXHRdKTtcblxuXHRwcm94eVJlcXVlc3RNZXRob2RzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgSURCT2JqZWN0U3RvcmUsIFtcblx0XHQncHV0Jyxcblx0XHQnYWRkJyxcblx0XHQnZGVsZXRlJyxcblx0XHQnY2xlYXInLFxuXHRcdCdnZXQnLFxuXHRcdCdnZXRBbGwnLFxuXHRcdCdnZXRLZXknLFxuXHRcdCdnZXRBbGxLZXlzJyxcblx0XHQnY291bnQnXG5cdF0pO1xuXG5cdHByb3h5Q3Vyc29yUmVxdWVzdE1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuXHRcdCdvcGVuQ3Vyc29yJyxcblx0XHQnb3BlbktleUN1cnNvcidcblx0XSk7XG5cblx0cHJveHlNZXRob2RzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgSURCT2JqZWN0U3RvcmUsIFtcblx0XHQnZGVsZXRlSW5kZXgnXG5cdF0pO1xuXG5cdGZ1bmN0aW9uIFRyYW5zYWN0aW9uKGlkYlRyYW5zYWN0aW9uKSB7XG5cdFx0dGhpcy5fdHggPSBpZGJUcmFuc2FjdGlvbjtcblx0XHR0aGlzLmNvbXBsZXRlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG5cdFx0XHRpZGJUcmFuc2FjdGlvbi5vbmNvbXBsZXRlID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJlc29sdmUoKTtcblx0XHRcdH07XG5cdFx0XHRpZGJUcmFuc2FjdGlvbi5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJlamVjdChpZGJUcmFuc2FjdGlvbi5lcnJvcik7XG5cdFx0XHR9O1xuXHRcdFx0aWRiVHJhbnNhY3Rpb24ub25hYm9ydCA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRyZWplY3QoaWRiVHJhbnNhY3Rpb24uZXJyb3IpO1xuXHRcdFx0fTtcblx0XHR9KTtcblx0fVxuXG5cdFRyYW5zYWN0aW9uLnByb3RvdHlwZS5vYmplY3RTdG9yZSA9IGZ1bmN0aW9uKCkge1xuXHRcdHJldHVybiBuZXcgT2JqZWN0U3RvcmUodGhpcy5fdHgub2JqZWN0U3RvcmUuYXBwbHkodGhpcy5fdHgsIGFyZ3VtZW50cykpO1xuXHR9O1xuXG5cdHByb3h5UHJvcGVydGllcyhUcmFuc2FjdGlvbiwgJ190eCcsIFtcblx0XHQnb2JqZWN0U3RvcmVOYW1lcycsXG5cdFx0J21vZGUnXG5cdF0pO1xuXG5cdHByb3h5TWV0aG9kcyhUcmFuc2FjdGlvbiwgJ190eCcsIElEQlRyYW5zYWN0aW9uLCBbXG5cdFx0J2Fib3J0J1xuXHRdKTtcblxuXHRmdW5jdGlvbiBVcGdyYWRlREIoZGIsIG9sZFZlcnNpb24sIHRyYW5zYWN0aW9uKSB7XG5cdFx0dGhpcy5fZGIgPSBkYjtcblx0XHR0aGlzLm9sZFZlcnNpb24gPSBvbGRWZXJzaW9uO1xuXHRcdHRoaXMudHJhbnNhY3Rpb24gPSBuZXcgVHJhbnNhY3Rpb24odHJhbnNhY3Rpb24pO1xuXHR9XG5cblx0VXBncmFkZURCLnByb3RvdHlwZS5jcmVhdGVPYmplY3RTdG9yZSA9IGZ1bmN0aW9uKCkge1xuXHRcdHJldHVybiBuZXcgT2JqZWN0U3RvcmUodGhpcy5fZGIuY3JlYXRlT2JqZWN0U3RvcmUuYXBwbHkodGhpcy5fZGIsIGFyZ3VtZW50cykpO1xuXHR9O1xuXG5cdHByb3h5UHJvcGVydGllcyhVcGdyYWRlREIsICdfZGInLCBbXG5cdFx0J25hbWUnLFxuXHRcdCd2ZXJzaW9uJyxcblx0XHQnb2JqZWN0U3RvcmVOYW1lcydcblx0XSk7XG5cblx0cHJveHlNZXRob2RzKFVwZ3JhZGVEQiwgJ19kYicsIElEQkRhdGFiYXNlLCBbXG5cdFx0J2RlbGV0ZU9iamVjdFN0b3JlJyxcblx0XHQnY2xvc2UnXG5cdF0pO1xuXG5cdGZ1bmN0aW9uIERCKGRiKSB7XG5cdFx0dGhpcy5fZGIgPSBkYjtcblx0fVxuXG5cdERCLnByb3RvdHlwZS50cmFuc2FjdGlvbiA9IGZ1bmN0aW9uKCkge1xuXHRcdHJldHVybiBuZXcgVHJhbnNhY3Rpb24odGhpcy5fZGIudHJhbnNhY3Rpb24uYXBwbHkodGhpcy5fZGIsIGFyZ3VtZW50cykpO1xuXHR9O1xuXG5cdHByb3h5UHJvcGVydGllcyhEQiwgJ19kYicsIFtcblx0XHQnbmFtZScsXG5cdFx0J3ZlcnNpb24nLFxuXHRcdCdvYmplY3RTdG9yZU5hbWVzJ1xuXHRdKTtcblxuXHRwcm94eU1ldGhvZHMoREIsICdfZGInLCBJREJEYXRhYmFzZSwgW1xuXHRcdCdjbG9zZSdcblx0XSk7XG5cblx0Ly8gQWRkIGN1cnNvciBpdGVyYXRvcnNcblx0Ly8gVE9ETzogcmVtb3ZlIHRoaXMgb25jZSBicm93c2VycyBkbyB0aGUgcmlnaHQgdGhpbmcgd2l0aCBwcm9taXNlc1xuXHRbJ29wZW5DdXJzb3InLCAnb3BlbktleUN1cnNvciddLmZvckVhY2goZnVuY3Rpb24oZnVuY05hbWUpIHtcblx0XHRbT2JqZWN0U3RvcmUsIEluZGV4XS5mb3JFYWNoKGZ1bmN0aW9uKENvbnN0cnVjdG9yKSB7XG5cdFx0XHQvLyBEb24ndCBjcmVhdGUgaXRlcmF0ZUtleUN1cnNvciBpZiBvcGVuS2V5Q3Vyc29yIGRvZXNuJ3QgZXhpc3QuXG5cdFx0XHRpZiAoIShmdW5jTmFtZSBpbiBDb25zdHJ1Y3Rvci5wcm90b3R5cGUpKSByZXR1cm47XG5cblx0XHRcdENvbnN0cnVjdG9yLnByb3RvdHlwZVtmdW5jTmFtZS5yZXBsYWNlKCdvcGVuJywgJ2l0ZXJhdGUnKV0gPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0dmFyIGFyZ3MgPSB0b0FycmF5KGFyZ3VtZW50cyk7XG5cdFx0XHRcdHZhciBjYWxsYmFjayA9IGFyZ3NbYXJncy5sZW5ndGggLSAxXTtcblx0XHRcdFx0dmFyIG5hdGl2ZU9iamVjdCA9IHRoaXMuX3N0b3JlIHx8IHRoaXMuX2luZGV4O1xuXHRcdFx0XHR2YXIgcmVxdWVzdCA9IG5hdGl2ZU9iamVjdFtmdW5jTmFtZV0uYXBwbHkobmF0aXZlT2JqZWN0LCBhcmdzLnNsaWNlKDAsIC0xKSk7XG5cdFx0XHRcdHJlcXVlc3Qub25zdWNjZXNzID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdFx0Y2FsbGJhY2socmVxdWVzdC5yZXN1bHQpO1xuXHRcdFx0XHR9O1xuXHRcdFx0fTtcblx0XHR9KTtcblx0fSk7XG5cblx0Ly8gcG9seWZpbGwgZ2V0QWxsXG5cdFtJbmRleCwgT2JqZWN0U3RvcmVdLmZvckVhY2goZnVuY3Rpb24oQ29uc3RydWN0b3IpIHtcblx0XHRpZiAoQ29uc3RydWN0b3IucHJvdG90eXBlLmdldEFsbCkgcmV0dXJuO1xuXHRcdENvbnN0cnVjdG9yLnByb3RvdHlwZS5nZXRBbGwgPSBmdW5jdGlvbihxdWVyeSwgY291bnQpIHtcblx0XHRcdHZhciBpbnN0YW5jZSA9IHRoaXM7XG5cdFx0XHR2YXIgaXRlbXMgPSBbXTtcblxuXHRcdFx0cmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUpIHtcblx0XHRcdFx0aW5zdGFuY2UuaXRlcmF0ZUN1cnNvcihxdWVyeSwgZnVuY3Rpb24oY3Vyc29yKSB7XG5cdFx0XHRcdFx0aWYgKCFjdXJzb3IpIHtcblx0XHRcdFx0XHRcdHJlc29sdmUoaXRlbXMpO1xuXHRcdFx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0XHRpdGVtcy5wdXNoKGN1cnNvci52YWx1ZSk7XG5cblx0XHRcdFx0XHRpZiAoY291bnQgIT09IHVuZGVmaW5lZCAmJiBpdGVtcy5sZW5ndGggPT0gY291bnQpIHtcblx0XHRcdFx0XHRcdHJlc29sdmUoaXRlbXMpO1xuXHRcdFx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0XHRjdXJzb3IuY29udGludWUoKTtcblx0XHRcdFx0fSk7XG5cdFx0XHR9KTtcblx0XHR9O1xuXHR9KTtcblxuXHR2YXIgZXhwID0ge1xuXHRcdG9wZW46IGZ1bmN0aW9uKG5hbWUsIHZlcnNpb24sIHVwZ3JhZGVDYWxsYmFjaykge1xuXHRcdFx0dmFyIHAgPSBwcm9taXNpZnlSZXF1ZXN0Q2FsbChpbmRleGVkREIsICdvcGVuJywgW25hbWUsIHZlcnNpb25dKTtcblx0XHRcdHZhciByZXF1ZXN0ID0gcC5yZXF1ZXN0O1xuXG5cdFx0XHRpZiAocmVxdWVzdCkge1xuXHRcdFx0XHRyZXF1ZXN0Lm9udXBncmFkZW5lZWRlZCA9IGZ1bmN0aW9uKGV2ZW50KSB7XG5cdFx0XHRcdFx0aWYgKHVwZ3JhZGVDYWxsYmFjaykge1xuXHRcdFx0XHRcdFx0dXBncmFkZUNhbGxiYWNrKG5ldyBVcGdyYWRlREIocmVxdWVzdC5yZXN1bHQsIGV2ZW50Lm9sZFZlcnNpb24sIHJlcXVlc3QudHJhbnNhY3Rpb24pKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH07XG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiBwLnRoZW4oZnVuY3Rpb24oZGIpIHtcblx0XHRcdFx0cmV0dXJuIG5ldyBEQihkYik7XG5cdFx0XHR9KTtcblx0XHR9LFxuXHRcdGRlbGV0ZTogZnVuY3Rpb24obmFtZSkge1xuXHRcdFx0cmV0dXJuIHByb21pc2lmeVJlcXVlc3RDYWxsKGluZGV4ZWREQiwgJ2RlbGV0ZURhdGFiYXNlJywgW25hbWVdKTtcblx0XHR9XG5cdH07XG5cblx0aWYgKHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnKSB7XG5cdFx0bW9kdWxlLmV4cG9ydHMgPSBleHA7XG5cdFx0bW9kdWxlLmV4cG9ydHMuZGVmYXVsdCA9IG1vZHVsZS5leHBvcnRzO1xuXHR9XG5cdGVsc2Uge1xuXHRcdHNlbGYuaWRiID0gZXhwO1xuXHR9XG59KCkpO1xuIiwidmFyIEFQSV9VUkwgPSAnaHR0cDovL2xvY2FsaG9zdDoxMzM3L3Jlc3RhdXJhbnRzJztcbnZhciBmZXRjaFN0YXR1cyA9IDA7XG5cbi8vIEhlbHBlciBGdW5jdGlvbnMgZm9yIHZhcmlvdXMgSURiIE9wZXJhdGlvbnNcbmNsYXNzIElEYk9wZXJhdGlvbnNIZWxwZXIge1xuXHRzdGF0aWMgY2hlY2tGb3JJRGJTdXBwb3J0KCkge1xuXHRcdGlmICghKCdpbmRleGVkREInIGluIHdpbmRvdykpIHtcblx0XHRcdHJldHVybiAwO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRyZXR1cm4gMTtcblx0XHR9XG5cdH1cblxuXHRzdGF0aWMgb3BlbklEYihuYW1lLCB2ZXJzaW9uLCBvYmplY3RTdG9yZU5hbWUpIHtcblx0XHR2YXIgZGJQcm9taXNlID0gaWRiLm9wZW4obmFtZSwgdmVyc2lvbiwgdXBncmFkZURCID0+IHtcblx0XHRcdHVwZ3JhZGVEQi5jcmVhdGVPYmplY3RTdG9yZShvYmplY3RTdG9yZU5hbWUsIHsgYXV0b0luY3JlbWVudDogdHJ1ZSB9KTtcblx0XHR9KTtcblx0XHRyZXR1cm4gZGJQcm9taXNlO1xuXHR9XG5cblx0c3RhdGljIGFkZFRvRGIoZGJQcm9taXNlLCBvYmplY3RTdG9yZU5hbWUsIHBlcm1pc2lvbiwganNvbkRhdGEpIHtcblx0XHRkYlByb21pc2UudGhlbihkYiA9PiB7XG5cdFx0XHR2YXIgdHJhbnNhY3QgPSBkYi50cmFuc2FjdGlvbihvYmplY3RTdG9yZU5hbWUsIHBlcm1pc2lvbik7XG5cdFx0XHQvL0FkZCBhbGwgdGhlIGpzb24gY29udGVudCBoZXJlXG5cdFx0XHR0cmFuc2FjdC5vYmplY3RTdG9yZShvYmplY3RTdG9yZU5hbWUpLnB1dChqc29uRGF0YSk7XG5cdFx0XHRyZXR1cm4gdHJhbnNhY3QuY29tcGxldGU7XG5cdFx0fSkudGhlbihyZXNwb25zZSA9PiB7XG5cdFx0XHRjb25zb2xlLmxvZygnUmVzdGF1cmFudCBzYXZlZCB0byBJRGInKTtcblx0XHR9KTtcblx0fVxuXG5cdHN0YXRpYyBnZXRBbGxEYXRhKGRiUHJvbWlzZSwgdHJhbnNhY3Rpb25OYW1lLCBvYmplY3RTdG9yZU5hbWUpIHtcblx0XHR2YXIgcmVzcG9uc2VBcnJheVByb21pc2UgPSBkYlByb21pc2UudGhlbihkYiA9PiBkYlxuXHRcdFx0LnRyYW5zYWN0aW9uKHRyYW5zYWN0aW9uTmFtZSlcblx0XHRcdC5vYmplY3RTdG9yZShvYmplY3RTdG9yZU5hbWUpXG5cdFx0XHQuZ2V0QWxsKClcblx0XHQpO1xuXHRcdHJlc3BvbnNlQXJyYXlQcm9taXNlLnRoZW4oYXJyeSA9PiB7XG5cdFx0XHRJRGJPcGVyYXRpb25zSGVscGVyLnNldFJlc3RhdXJhbnRzRGF0YShhcnJ5KTtcblx0XHR9KTtcblx0fVxuXG5cdHN0YXRpYyBnZXRSZXN0YXVyYW50c0Zyb21TZXJ2ZXIoZGJQcm9taXNlLCBvYmplY3RTdG9yZU5hbWUsIHBlcm1pc2lvbiwgY2FsbGJhY2spIHtcblx0XHRmZXRjaChBUElfVVJMKVxuXHRcdFx0LnRoZW4ocmVzcG9uc2UgPT4gcmVzcG9uc2UuanNvbigpKVxuXHRcdFx0LnRoZW4ocmVzcG9uc2VKc29uID0+IHtcblx0XHRcdFx0cmVzcG9uc2VKc29uLmZvckVhY2gocmVzdGF1cmFudCA9PiB7XG5cdFx0XHRcdFx0cmVzdGF1cmFudCA9IElEYk9wZXJhdGlvbnNIZWxwZXIuYWRkTWlzc2luZ0RhdGEocmVzdGF1cmFudCk7XG5cdFx0XHRcdH0pO1xuXG5cdFx0XHRcdGlmIChmZXRjaFN0YXR1cyAhPSAxKSB7XG5cdFx0XHRcdFx0ZmV0Y2hTdGF0dXMgPSAxO1xuXHRcdFx0XHRcdHJlc3BvbnNlSnNvbi5mb3JFYWNoKHJlc3RhdXJhbnREYXRhID0+IHtcblxuXHRcdFx0XHRcdFx0Ly9BZGQgZXZlcnkgc2luZ2xlIHJlc3RhdXJhbnQgZGF0YSB0byBJRGJcblx0XHRcdFx0XHRcdElEYk9wZXJhdGlvbnNIZWxwZXIuYWRkVG9EYihcblx0XHRcdFx0XHRcdFx0ZGJQcm9taXNlLFxuXHRcdFx0XHRcdFx0XHRvYmplY3RTdG9yZU5hbWUsXG5cdFx0XHRcdFx0XHRcdHBlcm1pc2lvbixcblx0XHRcdFx0XHRcdFx0cmVzdGF1cmFudERhdGFcblx0XHRcdFx0XHRcdCk7XG5cdFx0XHRcdFx0fSk7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRjb25zb2xlLmxvZyhyZXNwb25zZUpzb24pO1xuXHRcdFx0XHRjYWxsYmFjayAobnVsbCwgcmVzcG9uc2VKc29uKTtcblx0XHRcdH0pLmNhdGNoKGVycm9yID0+IHtcblx0XHRcdFx0Y29uc29sZS5sb2coYFVuYWJsZSB0byBmZXRjaCByZXN0YXVyYW50cywgRXJyb3I6ICR7ZXJyb3J9YCk7XG5cdFx0XHRcdGNhbGxiYWNrIChlcnJvciwgbnVsbCk7XG5cdFx0XHR9KTtcblx0fVxuXG5cdHN0YXRpYyBnZXRSZXN0YXVyYW50c0RhdGEoY2FsbGJhY2spIHtcblx0XHR2YXIgaWRiTmFtZSA9ICdyZXN0YXVyYW50cy1kYXRhJztcblx0XHR2YXIgZGJWZXJzaW9uID0gMTtcblx0XHR2YXIgb2JqZWN0U3RvcmVOYW1lU3RyaW5nID0gJ3Jlc3RhdXJhbnRzJztcblx0XHR2YXIgdHJhbnNhY3Rpb25OYW1lU3RyaW5nID0gJ3Jlc3RhdXJhbnRzJztcblx0XHR2YXIgZGJQZXJtaXNzaW9uID0gJ3JlYWR3cml0ZSc7XG5cblx0XHR2YXIgZGJQcm9taXNlID0gSURiT3BlcmF0aW9uc0hlbHBlci5vcGVuSURiKFxuXHRcdFx0aWRiTmFtZSxcblx0XHRcdGRiVmVyc2lvbixcblx0XHRcdG9iamVjdFN0b3JlTmFtZVN0cmluZ1xuXHRcdCk7XG5cblx0XHRkYlByb21pc2UudGhlbihkYiA9PlxuXHRcdFx0ZGIudHJhbnNhY3Rpb24odHJhbnNhY3Rpb25OYW1lU3RyaW5nKVxuXHRcdFx0XHQub2JqZWN0U3RvcmUob2JqZWN0U3RvcmVOYW1lU3RyaW5nKVxuXHRcdFx0XHQuZ2V0QWxsKClcblx0XHQpLnRoZW4ocmVzcG9uc2VPYmVqY3RzID0+IHtcblx0XHRcdGlmIChyZXNwb25zZU9iZWpjdHMubGVuZ3RoIDw9IDApIHtcblx0XHRcdFx0SURiT3BlcmF0aW9uc0hlbHBlci5nZXRSZXN0YXVyYW50c0Zyb21TZXJ2ZXIoXG5cdFx0XHRcdFx0ZGJQcm9taXNlLFxuXHRcdFx0XHRcdG9iamVjdFN0b3JlTmFtZVN0cmluZyxcblx0XHRcdFx0XHRkYlBlcm1pc3Npb24sXG5cdFx0XHRcdFx0Y2FsbGJhY2tcblx0XHRcdFx0KTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdGNhbGxiYWNrKG51bGwsIHJlc3BvbnNlT2JlamN0cyk7XG5cdFx0XHR9XG5cdFx0fSk7XG5cdH1cblxuXHQvLyBIYW5kbGUgZm9yIGxhc3QgZW50cnkgb24gUmVzdGF1cmFudHMgTGlzdFxuXHRzdGF0aWMgYWRkTWlzc2luZ0RhdGEocmVzdEpzb24pIHtcblx0XHRpZiAoIWlzTmFOKHJlc3RKc29uLnBob3RvZ3JhcGgpKSB7XG5cdFx0XHRyZXN0SnNvbi5waG90b2dyYXBoID0gcmVzdEpzb24ucGhvdG9ncmFwaCArICcuanBnJztcblx0XHR9IGVsc2Uge1xuXHRcdFx0cmVzdEpzb25bJ3Bob3RvZ3JhcGgnXSA9IHJlc3RKc29uLmlkICsgJy5qcGcnO1xuXHRcdH1cblx0XHRyZXR1cm4gcmVzdEpzb247XG5cdH1cbn1cbiIsIi8vIENvbW1vbiBkYXRhYmFzZSBoZWxwZXIgZnVuY3Rpb25zLlxuY2xhc3MgREJIZWxwZXIge1xuXHRzdGF0aWMgZ2V0IE5FV19VUkwoKSB7XG5cdFx0cmV0dXJuICdodHRwOi8vbG9jYWxob3N0OjEzMzcvcmVzdGF1cmFudHMnO1xuXHR9XG5cdC8qKlxuICAgICAqIEZldGNoIGEgcmVzdGF1cmFudCBieSBpdHMgSUQuXG4gICAgICovXG5cdHN0YXRpYyBmZXRjaFJlc3RhdXJhbnRCeUlkKGlkLCBjYWxsYmFjaykge1xuXHRcdC8vIGZldGNoIGFsbCByZXN0YXVyYW50cyB3aXRoIHByb3BlciBlcnJvciBoYW5kbGluZy5cblx0XHRJRGJPcGVyYXRpb25zSGVscGVyLmdldFJlc3RhdXJhbnRzRGF0YSgoZXJyb3IsIHJlc3RhdXJhbnRzKSA9PiB7XG5cdFx0XHRpZiAoZXJyb3IpIHtcblx0XHRcdFx0Y2FsbGJhY2soZXJyb3IsIG51bGwpO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0Y29uc3QgcmVzdGF1cmFudCA9IHJlc3RhdXJhbnRzLmZpbmQociA9PiByLmlkID09IGlkKTtcblx0XHRcdFx0aWYgKHJlc3RhdXJhbnQpIHtcblx0XHRcdFx0XHQvLyBHb3QgdGhlIHJlc3RhdXJhbnRcblx0XHRcdFx0XHRjYWxsYmFjayhudWxsLCByZXN0YXVyYW50KTtcblx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHQvLyBSZXN0YXVyYW50IGRvZXMgbm90IGV4aXN0IGluIHRoZSBkYXRhYmFzZVxuXHRcdFx0XHRcdGNhbGxiYWNrKCdSZXN0YXVyYW50IGRvZXMgbm90IGV4aXN0JywgbnVsbCk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9KTtcblx0fVxuXG5cdC8qKlxuICAgICAqIEZldGNoIHJlc3RhdXJhbnRzIGJ5IGEgY3Vpc2luZSB0eXBlIHdpdGggcHJvcGVyIGVycm9yIGhhbmRsaW5nLlxuICAgICAqL1xuXHRzdGF0aWMgZmV0Y2hSZXN0YXVyYW50QnlDdWlzaW5lKGN1aXNpbmUsIGNhbGxiYWNrKSB7XG5cdFx0Ly8gRmV0Y2ggYWxsIHJlc3RhdXJhbnRzICB3aXRoIHByb3BlciBlcnJvciBoYW5kbGluZ1xuXHRcdElEYk9wZXJhdGlvbnNIZWxwZXIuZ2V0UmVzdGF1cmFudHNEYXRhKChlcnJvciwgcmVzdGF1cmFudHMpID0+IHtcblx0XHRcdGlmIChlcnJvcikge1xuXHRcdFx0XHRjYWxsYmFjayhlcnJvciwgbnVsbCk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHQvLyBGaWx0ZXIgcmVzdGF1cmFudHMgdG8gaGF2ZSBvbmx5IGdpdmVuIGN1aXNpbmUgdHlwZVxuXHRcdFx0XHRjb25zdCByZXN1bHRzID0gcmVzdGF1cmFudHMuZmlsdGVyKHIgPT4gci5jdWlzaW5lX3R5cGUgPT0gY3Vpc2luZSk7XG5cdFx0XHRcdGNhbGxiYWNrKG51bGwsIHJlc3VsdHMpO1xuXHRcdFx0fVxuXHRcdH0pO1xuXHR9XG5cblx0LyoqXG4gICAgICogRmV0Y2ggcmVzdGF1cmFudHMgYnkgYSBuZWlnaGJvcmhvb2Qgd2l0aCBwcm9wZXIgZXJyb3IgaGFuZGxpbmcuXG4gICAgICovXG5cdHN0YXRpYyBmZXRjaFJlc3RhdXJhbnRCeU5laWdoYm9yaG9vZChuZWlnaGJvcmhvb2QsIGNhbGxiYWNrKSB7XG5cdFx0Ly8gRmV0Y2ggYWxsIHJlc3RhdXJhbnRzXG5cdFx0SURiT3BlcmF0aW9uc0hlbHBlci5nZXRSZXN0YXVyYW50c0RhdGEoKGVycm9yLCByZXN0YXVyYW50cykgPT4ge1xuXHRcdFx0aWYgKGVycm9yKSB7XG5cdFx0XHRcdGNhbGxiYWNrKGVycm9yLCBudWxsKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdC8vIEZpbHRlciByZXN0YXVyYW50cyB0byBoYXZlIG9ubHkgZ2l2ZW4gbmVpZ2hib3Job29kXG5cdFx0XHRcdGNvbnN0IHJlc3VsdHMgPSByZXN0YXVyYW50cy5maWx0ZXIociA9PiByLm5laWdoYm9yaG9vZCA9PSBuZWlnaGJvcmhvb2QpO1xuXHRcdFx0XHRjYWxsYmFjayhudWxsLCByZXN1bHRzKTtcblx0XHRcdH1cblx0XHR9KTtcblx0fVxuXG5cdC8qKlxuICAgICAqIEZldGNoIHJlc3RhdXJhbnRzIGJ5IGEgY3Vpc2luZSBhbmQgYSBuZWlnaGJvcmhvb2Qgd2l0aCBwcm9wZXIgZXJyb3IgaGFuZGxpbmcuXG4gICAgICovXG5cdHN0YXRpYyBmZXRjaFJlc3RhdXJhbnRCeUN1aXNpbmVBbmROZWlnaGJvcmhvb2QoXG5cdFx0Y3Vpc2luZSxcblx0XHRuZWlnaGJvcmhvb2QsXG5cdFx0Y2FsbGJhY2tcblx0KSB7XG5cdFx0Ly8gRmV0Y2ggYWxsIHJlc3RhdXJhbnRzXG5cdFx0SURiT3BlcmF0aW9uc0hlbHBlci5nZXRSZXN0YXVyYW50c0RhdGEoKGVycm9yLCByZXN0YXVyYW50cykgPT4ge1xuXHRcdFx0aWYgKGVycm9yKSB7XG5cdFx0XHRcdGNhbGxiYWNrKGVycm9yLCBudWxsKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdGxldCByZXN1bHRzID0gcmVzdGF1cmFudHM7XG5cdFx0XHRcdGlmIChjdWlzaW5lICE9ICdhbGwnKSB7XG5cdFx0XHRcdFx0Ly8gZmlsdGVyIGJ5IGN1aXNpbmVcblx0XHRcdFx0XHRyZXN1bHRzID0gcmVzdWx0cy5maWx0ZXIociA9PiByLmN1aXNpbmVfdHlwZSA9PSBjdWlzaW5lKTtcblx0XHRcdFx0fVxuXHRcdFx0XHRpZiAobmVpZ2hib3Job29kICE9ICdhbGwnKSB7XG5cdFx0XHRcdFx0Ly8gZmlsdGVyIGJ5IG5laWdoYm9yaG9vZFxuXHRcdFx0XHRcdHJlc3VsdHMgPSByZXN1bHRzLmZpbHRlcihyID0+IHIubmVpZ2hib3Job29kID09IG5laWdoYm9yaG9vZCk7XG5cdFx0XHRcdH1cblx0XHRcdFx0Y2FsbGJhY2sobnVsbCwgcmVzdWx0cyk7XG5cdFx0XHR9XG5cdFx0fSk7XG5cdH1cblxuXHQvKipcbiAgICAgKiBGZXRjaCBhbGwgbmVpZ2hib3Job29kcyB3aXRoIHByb3BlciBlcnJvciBoYW5kbGluZy5cbiAgICAgKi9cblx0c3RhdGljIGZldGNoTmVpZ2hib3Job29kcyhjYWxsYmFjaykge1xuXHRcdC8vIEZldGNoIGFsbCByZXN0YXVyYW50c1xuXHRcdElEYk9wZXJhdGlvbnNIZWxwZXIuZ2V0UmVzdGF1cmFudHNEYXRhKChlcnJvciwgcmVzdGF1cmFudHMpID0+IHtcblx0XHRcdGlmIChlcnJvcikge1xuXHRcdFx0XHRjYWxsYmFjayhlcnJvciwgbnVsbCk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHQvLyBHZXQgYWxsIG5laWdoYm9yaG9vZHMgZnJvbSBhbGwgcmVzdGF1cmFudHNcblx0XHRcdFx0Y29uc3QgbmVpZ2hib3Job29kcyA9IHJlc3RhdXJhbnRzLm1hcChcblx0XHRcdFx0XHQodiwgaSkgPT4gcmVzdGF1cmFudHNbaV0ubmVpZ2hib3Job29kXG5cdFx0XHRcdCk7XG5cdFx0XHRcdC8vIFJlbW92ZSBkdXBsaWNhdGVzIGZyb20gbmVpZ2hib3Job29kc1xuXHRcdFx0XHRjb25zdCB1bmlxdWVOZWlnaGJvcmhvb2RzID0gbmVpZ2hib3Job29kcy5maWx0ZXIoXG5cdFx0XHRcdFx0KHYsIGkpID0+IG5laWdoYm9yaG9vZHMuaW5kZXhPZih2KSA9PSBpXG5cdFx0XHRcdCk7XG5cdFx0XHRcdGNhbGxiYWNrKG51bGwsIHVuaXF1ZU5laWdoYm9yaG9vZHMpO1xuXHRcdFx0fVxuXHRcdH0pO1xuXHR9XG5cblx0LyoqXG4gICAgICogRmV0Y2ggYWxsIGN1aXNpbmVzIHdpdGggcHJvcGVyIGVycm9yIGhhbmRsaW5nLlxuICAgICAqL1xuXHRzdGF0aWMgZmV0Y2hDdWlzaW5lcyhjYWxsYmFjaykge1xuXHRcdC8vIEZldGNoIGFsbCByZXN0YXVyYW50c1xuXHRcdElEYk9wZXJhdGlvbnNIZWxwZXIuZ2V0UmVzdGF1cmFudHNEYXRhKChlcnJvciwgcmVzdGF1cmFudHMpID0+IHtcblx0XHRcdGlmIChlcnJvcikge1xuXHRcdFx0XHRjYWxsYmFjayhlcnJvciwgbnVsbCk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHQvLyBHZXQgYWxsIGN1aXNpbmVzIGZyb20gYWxsIHJlc3RhdXJhbnRzXG5cdFx0XHRcdGNvbnN0IGN1aXNpbmVzID0gcmVzdGF1cmFudHMubWFwKCh2LCBpKSA9PiByZXN0YXVyYW50c1tpXS5jdWlzaW5lX3R5cGUpO1xuXHRcdFx0XHQvLyBSZW1vdmUgZHVwbGljYXRlcyBmcm9tIGN1aXNpbmVzXG5cdFx0XHRcdGNvbnN0IHVuaXF1ZUN1aXNpbmVzID0gY3Vpc2luZXMuZmlsdGVyKFxuXHRcdFx0XHRcdCh2LCBpKSA9PiBjdWlzaW5lcy5pbmRleE9mKHYpID09IGlcblx0XHRcdFx0KTtcblx0XHRcdFx0Y2FsbGJhY2sobnVsbCwgdW5pcXVlQ3Vpc2luZXMpO1xuXHRcdFx0fVxuXHRcdH0pO1xuXHR9XG5cblx0LyoqXG4gICAgICogUmVzdGF1cmFudCBwYWdlIFVSTC5cbiAgICAgKi9cblx0c3RhdGljIHVybEZvclJlc3RhdXJhbnQocmVzdGF1cmFudCkge1xuXHRcdHJldHVybiBgLi9yZXN0YXVyYW50Lmh0bWw/aWQ9JHtyZXN0YXVyYW50LmlkfWA7XG5cdH1cblxuXHQvKipcbiAgICAgKiBSZXN0YXVyYW50IGltYWdlIFVSTC5cbiAgICAgKi9cblx0c3RhdGljIGltYWdlVXJsRm9yUmVzdGF1cmFudChyZXN0YXVyYW50KSB7XG5cdFx0cmV0dXJuIGAvaW1nLyR7cmVzdGF1cmFudC5waG90b2dyYXBofWA7XG5cdH1cblxuXHQvKipcbiAgICAgKiBNYXAgbWFya2VyIGZvciBhIHJlc3RhdXJhbnQuXG4gICAgICovXG5cdHN0YXRpYyBtYXBNYXJrZXJGb3JSZXN0YXVyYW50KHJlc3RhdXJhbnQsIG1hcCkge1xuXHRcdGNvbnN0IG1hcmtlciA9IG5ldyBMLm1hcmtlcihcblx0XHRcdFtyZXN0YXVyYW50LmxhdGxuZy5sYXQsIHJlc3RhdXJhbnQubGF0bG5nLmxuZ10sXG5cdFx0XHR7XG5cdFx0XHRcdHRpdGxlOiByZXN0YXVyYW50Lm5hbWUsXG5cdFx0XHRcdGFsdDogcmVzdGF1cmFudC5uYW1lLFxuXHRcdFx0XHR1cmw6IERCSGVscGVyLnVybEZvclJlc3RhdXJhbnQocmVzdGF1cmFudClcblx0XHRcdH1cblx0XHQpO1xuXHRcdG1hcmtlci5hZGRUbyhuZXdNYXApO1xuXHRcdHJldHVybiBtYXJrZXI7XG5cdH1cbn1cbiJdfQ==
