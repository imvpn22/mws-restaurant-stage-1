if (navigator.serviceWorker) {
	navigator.serviceWorker.register('/sw.js').then(reg => {
		console.log('*** Service Worker registered ***');
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
var reviewsFetchStatus = 0;
var DB_VERSION = 1;

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
			console.log('Restaurant saved to IDB');
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

	static getDataFromServer(dbPromise, objectStoreName, permision, callback) {
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
				// console.log(responseJson);
				callback (null, responseJson);
			}).catch(error => {
				// console.log(`Unable to fetch restaurants, Error: ${error}`);
				callback (error, null);
			});
	}

	static getRestaurantsData(callback) {
		var idbName = 'restaurants-data';
		var dbVersion = DB_VERSION;
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
				IDbOperationsHelper.getDataFromServer(
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

	/* FAILED::: Function to update the Restaurant data*/
	static updateRestaurantData(restaurant) {
		var idbName = 'restaurants-data';
		var dbVersion = DB_VERSION;
		var objectStoreName = 'restaurants';
		var transactionName = 'restaurants';
		var dbPermission = 'readwrite';

		var dbPromise = IDbOperationsHelper.openIDb(
			idbName,
			dbVersion,
			objectStoreName
		);

		/* Put JSON data to indexDB*/
		dbPromise.then(db => {
			 return db.transaction(objectStoreName, dbPermission)
			.objectStore(objectStoreName)
			.put(restaurant)
		}
		).then(res => {
			console.log('test success');
			console.log(res);
		}).catch(err => {
			console.log('test failed');
			console.log(err);
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

	/* Fetch All reviews from server and save to IndexDB ObjectStore*/
	static getReviewsFromServer(dbPromise, objectStoreName, permision, callback) {
		fetch(`http://localhost:1337/reviews/`)
			.then(response => response.json())
			.then(responseJson => {
				// Sort by restaurant ID
				// responseJson.sort((a,b) => a.restaurant_id - b.restaurant_id);

				// Add Reviews in IndexDB if not added before
				if (reviewsFetchStatus != 1) {
					reviewsFetchStatus = 1;
					responseJson.forEach(restaurantData => {
						IDbOperationsHelper.addToDb(
							dbPromise,
							objectStoreName,
							permision,
							restaurantData
						);
					});
				}
				callback (null, responseJson);
			}).catch(error => {
				callback (error, null);
			});
	}

	static getReviewsData(callback) {
		var idbName = 'restaurants-data';
		var dbVersion = DB_VERSION;
		var objectStoreNameString = 'reviews';
		var transactionNameString = 'reviews';
		var dbPermission = 'readwrite';

		var dbPromise = IDbOperationsHelper.openIDb(
			idbName,
			dbVersion,
			objectStoreNameString
		);

		dbPromise.then(db =>
			db.transaction(transactionNameString, dbPermission)
				.objectStore(objectStoreNameString)
				.getAll()
		).then(responseObejcts => {
			if (responseObejcts.length <= 0) {
				IDbOperationsHelper.getReviewsFromServer(
					dbPromise,
					objectStoreNameString,
					dbPermission,
					callback
				);
			} else {
				callback(null, responseObejcts);
			}
		}).catch(err => {
			callback(err, null);
		});
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

	/* Get reviews for a restaurant*/
	static fetchReviewsForRestaurant(restaurant_id, callback) {
		IDbOperationsHelper.getReviewsData((error, allReviews) => {
			if (error) {
				callback(error, null);
			} else {
				let reviews = allReviews.filter(r => r.restaurant_id == restaurant_id);
				if (reviews) {
					callback(null, reviews);
				} else {
					callback('Review does not exist', null);
				}
			}
		});
	}
}

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImluZGV4Q29udHJvbGxlci5qcyIsImlkYi5qcyIsIklEYk9wZXJhdGlvbnNIZWxwZXIuanMiLCJkYmhlbHBlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQzVUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FDMU1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJhcHAuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpZiAobmF2aWdhdG9yLnNlcnZpY2VXb3JrZXIpIHtcblx0bmF2aWdhdG9yLnNlcnZpY2VXb3JrZXIucmVnaXN0ZXIoJy9zdy5qcycpLnRoZW4ocmVnID0+IHtcblx0XHRjb25zb2xlLmxvZygnKioqIFNlcnZpY2UgV29ya2VyIHJlZ2lzdGVyZWQgKioqJyk7XG5cdH0pLmNhdGNoKGZ1bmN0aW9uKGVycikge1xuXHRcdGNvbnNvbGUubG9nKGVycik7XG5cdH0pO1xufVxuIiwiJ3VzZSBzdHJpY3QnO1xuXG4oZnVuY3Rpb24oKSB7XG5cdGZ1bmN0aW9uIHRvQXJyYXkoYXJyKSB7XG5cdFx0cmV0dXJuIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFycik7XG5cdH1cblxuXHRmdW5jdGlvbiBwcm9taXNpZnlSZXF1ZXN0KHJlcXVlc3QpIHtcblx0XHRyZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG5cdFx0XHRyZXF1ZXN0Lm9uc3VjY2VzcyA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRyZXNvbHZlKHJlcXVlc3QucmVzdWx0KTtcblx0XHRcdH07XG5cblx0XHRcdHJlcXVlc3Qub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRyZWplY3QocmVxdWVzdC5lcnJvcik7XG5cdFx0XHR9O1xuXHRcdH0pO1xuXHR9XG5cblx0ZnVuY3Rpb24gcHJvbWlzaWZ5UmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpIHtcblx0XHR2YXIgcmVxdWVzdDtcblx0XHR2YXIgcCA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuXHRcdFx0cmVxdWVzdCA9IG9ialttZXRob2RdLmFwcGx5KG9iaiwgYXJncyk7XG5cdFx0XHRwcm9taXNpZnlSZXF1ZXN0KHJlcXVlc3QpLnRoZW4ocmVzb2x2ZSwgcmVqZWN0KTtcblx0XHR9KTtcblxuXHRcdHAucmVxdWVzdCA9IHJlcXVlc3Q7XG5cdFx0cmV0dXJuIHA7XG5cdH1cblxuXHRmdW5jdGlvbiBwcm9taXNpZnlDdXJzb3JSZXF1ZXN0Q2FsbChvYmosIG1ldGhvZCwgYXJncykge1xuXHRcdHZhciBwID0gcHJvbWlzaWZ5UmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpO1xuXHRcdHJldHVybiBwLnRoZW4oZnVuY3Rpb24odmFsdWUpIHtcblx0XHRcdGlmICghdmFsdWUpIHJldHVybjtcblx0XHRcdHJldHVybiBuZXcgQ3Vyc29yKHZhbHVlLCBwLnJlcXVlc3QpO1xuXHRcdH0pO1xuXHR9XG5cblx0ZnVuY3Rpb24gcHJveHlQcm9wZXJ0aWVzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIHByb3BlcnRpZXMpIHtcblx0XHRwcm9wZXJ0aWVzLmZvckVhY2goZnVuY3Rpb24ocHJvcCkge1xuXHRcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KFByb3h5Q2xhc3MucHJvdG90eXBlLCBwcm9wLCB7XG5cdFx0XHRcdGdldDogZnVuY3Rpb24oKSB7XG5cdFx0XHRcdFx0cmV0dXJuIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF07XG5cdFx0XHRcdH0sXG5cdFx0XHRcdHNldDogZnVuY3Rpb24odmFsKSB7XG5cdFx0XHRcdFx0dGhpc1t0YXJnZXRQcm9wXVtwcm9wXSA9IHZhbDtcblx0XHRcdFx0fVxuXHRcdFx0fSk7XG5cdFx0fSk7XG5cdH1cblxuXHRmdW5jdGlvbiBwcm94eVJlcXVlc3RNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG5cdFx0cHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcblx0XHRcdGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuXHRcdFx0UHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmV0dXJuIHByb21pc2lmeVJlcXVlc3RDYWxsKHRoaXNbdGFyZ2V0UHJvcF0sIHByb3AsIGFyZ3VtZW50cyk7XG5cdFx0XHR9O1xuXHRcdH0pO1xuXHR9XG5cblx0ZnVuY3Rpb24gcHJveHlNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG5cdFx0cHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcblx0XHRcdGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuXHRcdFx0UHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmV0dXJuIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF0uYXBwbHkodGhpc1t0YXJnZXRQcm9wXSwgYXJndW1lbnRzKTtcblx0XHRcdH07XG5cdFx0fSk7XG5cdH1cblxuXHRmdW5jdGlvbiBwcm94eUN1cnNvclJlcXVlc3RNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG5cdFx0cHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcblx0XHRcdGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuXHRcdFx0UHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmV0dXJuIHByb21pc2lmeUN1cnNvclJlcXVlc3RDYWxsKHRoaXNbdGFyZ2V0UHJvcF0sIHByb3AsIGFyZ3VtZW50cyk7XG5cdFx0XHR9O1xuXHRcdH0pO1xuXHR9XG5cblx0ZnVuY3Rpb24gSW5kZXgoaW5kZXgpIHtcblx0XHR0aGlzLl9pbmRleCA9IGluZGV4O1xuXHR9XG5cblx0cHJveHlQcm9wZXJ0aWVzKEluZGV4LCAnX2luZGV4JywgW1xuXHRcdCduYW1lJyxcblx0XHQna2V5UGF0aCcsXG5cdFx0J211bHRpRW50cnknLFxuXHRcdCd1bmlxdWUnXG5cdF0pO1xuXG5cdHByb3h5UmVxdWVzdE1ldGhvZHMoSW5kZXgsICdfaW5kZXgnLCBJREJJbmRleCwgW1xuXHRcdCdnZXQnLFxuXHRcdCdnZXRLZXknLFxuXHRcdCdnZXRBbGwnLFxuXHRcdCdnZXRBbGxLZXlzJyxcblx0XHQnY291bnQnXG5cdF0pO1xuXG5cdHByb3h5Q3Vyc29yUmVxdWVzdE1ldGhvZHMoSW5kZXgsICdfaW5kZXgnLCBJREJJbmRleCwgW1xuXHRcdCdvcGVuQ3Vyc29yJyxcblx0XHQnb3BlbktleUN1cnNvcidcblx0XSk7XG5cblx0ZnVuY3Rpb24gQ3Vyc29yKGN1cnNvciwgcmVxdWVzdCkge1xuXHRcdHRoaXMuX2N1cnNvciA9IGN1cnNvcjtcblx0XHR0aGlzLl9yZXF1ZXN0ID0gcmVxdWVzdDtcblx0fVxuXG5cdHByb3h5UHJvcGVydGllcyhDdXJzb3IsICdfY3Vyc29yJywgW1xuXHRcdCdkaXJlY3Rpb24nLFxuXHRcdCdrZXknLFxuXHRcdCdwcmltYXJ5S2V5Jyxcblx0XHQndmFsdWUnXG5cdF0pO1xuXG5cdHByb3h5UmVxdWVzdE1ldGhvZHMoQ3Vyc29yLCAnX2N1cnNvcicsIElEQkN1cnNvciwgW1xuXHRcdCd1cGRhdGUnLFxuXHRcdCdkZWxldGUnXG5cdF0pO1xuXG5cdC8vIHByb3h5ICduZXh0JyBtZXRob2RzXG5cdFsnYWR2YW5jZScsICdjb250aW51ZScsICdjb250aW51ZVByaW1hcnlLZXknXS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZE5hbWUpIHtcblx0XHRpZiAoIShtZXRob2ROYW1lIGluIElEQkN1cnNvci5wcm90b3R5cGUpKSByZXR1cm47XG5cdFx0Q3Vyc29yLnByb3RvdHlwZVttZXRob2ROYW1lXSA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0dmFyIGN1cnNvciA9IHRoaXM7XG5cdFx0XHR2YXIgYXJncyA9IGFyZ3VtZW50cztcblx0XHRcdHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRjdXJzb3IuX2N1cnNvclttZXRob2ROYW1lXS5hcHBseShjdXJzb3IuX2N1cnNvciwgYXJncyk7XG5cdFx0XHRcdHJldHVybiBwcm9taXNpZnlSZXF1ZXN0KGN1cnNvci5fcmVxdWVzdCkudGhlbihmdW5jdGlvbih2YWx1ZSkge1xuXHRcdFx0XHRcdGlmICghdmFsdWUpIHJldHVybjtcblx0XHRcdFx0XHRyZXR1cm4gbmV3IEN1cnNvcih2YWx1ZSwgY3Vyc29yLl9yZXF1ZXN0KTtcblx0XHRcdFx0fSk7XG5cdFx0XHR9KTtcblx0XHR9O1xuXHR9KTtcblxuXHRmdW5jdGlvbiBPYmplY3RTdG9yZShzdG9yZSkge1xuXHRcdHRoaXMuX3N0b3JlID0gc3RvcmU7XG5cdH1cblxuXHRPYmplY3RTdG9yZS5wcm90b3R5cGUuY3JlYXRlSW5kZXggPSBmdW5jdGlvbigpIHtcblx0XHRyZXR1cm4gbmV3IEluZGV4KHRoaXMuX3N0b3JlLmNyZWF0ZUluZGV4LmFwcGx5KHRoaXMuX3N0b3JlLCBhcmd1bWVudHMpKTtcblx0fTtcblxuXHRPYmplY3RTdG9yZS5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbigpIHtcblx0XHRyZXR1cm4gbmV3IEluZGV4KHRoaXMuX3N0b3JlLmluZGV4LmFwcGx5KHRoaXMuX3N0b3JlLCBhcmd1bWVudHMpKTtcblx0fTtcblxuXHRwcm94eVByb3BlcnRpZXMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBbXG5cdFx0J25hbWUnLFxuXHRcdCdrZXlQYXRoJyxcblx0XHQnaW5kZXhOYW1lcycsXG5cdFx0J2F1dG9JbmNyZW1lbnQnXG5cdF0pO1xuXG5cdHByb3h5UmVxdWVzdE1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuXHRcdCdwdXQnLFxuXHRcdCdhZGQnLFxuXHRcdCdkZWxldGUnLFxuXHRcdCdjbGVhcicsXG5cdFx0J2dldCcsXG5cdFx0J2dldEFsbCcsXG5cdFx0J2dldEtleScsXG5cdFx0J2dldEFsbEtleXMnLFxuXHRcdCdjb3VudCdcblx0XSk7XG5cblx0cHJveHlDdXJzb3JSZXF1ZXN0TWV0aG9kcyhPYmplY3RTdG9yZSwgJ19zdG9yZScsIElEQk9iamVjdFN0b3JlLCBbXG5cdFx0J29wZW5DdXJzb3InLFxuXHRcdCdvcGVuS2V5Q3Vyc29yJ1xuXHRdKTtcblxuXHRwcm94eU1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuXHRcdCdkZWxldGVJbmRleCdcblx0XSk7XG5cblx0ZnVuY3Rpb24gVHJhbnNhY3Rpb24oaWRiVHJhbnNhY3Rpb24pIHtcblx0XHR0aGlzLl90eCA9IGlkYlRyYW5zYWN0aW9uO1xuXHRcdHRoaXMuY29tcGxldGUgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcblx0XHRcdGlkYlRyYW5zYWN0aW9uLm9uY29tcGxldGUgPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmVzb2x2ZSgpO1xuXHRcdFx0fTtcblx0XHRcdGlkYlRyYW5zYWN0aW9uLm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmVqZWN0KGlkYlRyYW5zYWN0aW9uLmVycm9yKTtcblx0XHRcdH07XG5cdFx0XHRpZGJUcmFuc2FjdGlvbi5vbmFib3J0ID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJlamVjdChpZGJUcmFuc2FjdGlvbi5lcnJvcik7XG5cdFx0XHR9O1xuXHRcdH0pO1xuXHR9XG5cblx0VHJhbnNhY3Rpb24ucHJvdG90eXBlLm9iamVjdFN0b3JlID0gZnVuY3Rpb24oKSB7XG5cdFx0cmV0dXJuIG5ldyBPYmplY3RTdG9yZSh0aGlzLl90eC5vYmplY3RTdG9yZS5hcHBseSh0aGlzLl90eCwgYXJndW1lbnRzKSk7XG5cdH07XG5cblx0cHJveHlQcm9wZXJ0aWVzKFRyYW5zYWN0aW9uLCAnX3R4JywgW1xuXHRcdCdvYmplY3RTdG9yZU5hbWVzJyxcblx0XHQnbW9kZSdcblx0XSk7XG5cblx0cHJveHlNZXRob2RzKFRyYW5zYWN0aW9uLCAnX3R4JywgSURCVHJhbnNhY3Rpb24sIFtcblx0XHQnYWJvcnQnXG5cdF0pO1xuXG5cdGZ1bmN0aW9uIFVwZ3JhZGVEQihkYiwgb2xkVmVyc2lvbiwgdHJhbnNhY3Rpb24pIHtcblx0XHR0aGlzLl9kYiA9IGRiO1xuXHRcdHRoaXMub2xkVmVyc2lvbiA9IG9sZFZlcnNpb247XG5cdFx0dGhpcy50cmFuc2FjdGlvbiA9IG5ldyBUcmFuc2FjdGlvbih0cmFuc2FjdGlvbik7XG5cdH1cblxuXHRVcGdyYWRlREIucHJvdG90eXBlLmNyZWF0ZU9iamVjdFN0b3JlID0gZnVuY3Rpb24oKSB7XG5cdFx0cmV0dXJuIG5ldyBPYmplY3RTdG9yZSh0aGlzLl9kYi5jcmVhdGVPYmplY3RTdG9yZS5hcHBseSh0aGlzLl9kYiwgYXJndW1lbnRzKSk7XG5cdH07XG5cblx0cHJveHlQcm9wZXJ0aWVzKFVwZ3JhZGVEQiwgJ19kYicsIFtcblx0XHQnbmFtZScsXG5cdFx0J3ZlcnNpb24nLFxuXHRcdCdvYmplY3RTdG9yZU5hbWVzJ1xuXHRdKTtcblxuXHRwcm94eU1ldGhvZHMoVXBncmFkZURCLCAnX2RiJywgSURCRGF0YWJhc2UsIFtcblx0XHQnZGVsZXRlT2JqZWN0U3RvcmUnLFxuXHRcdCdjbG9zZSdcblx0XSk7XG5cblx0ZnVuY3Rpb24gREIoZGIpIHtcblx0XHR0aGlzLl9kYiA9IGRiO1xuXHR9XG5cblx0REIucHJvdG90eXBlLnRyYW5zYWN0aW9uID0gZnVuY3Rpb24oKSB7XG5cdFx0cmV0dXJuIG5ldyBUcmFuc2FjdGlvbih0aGlzLl9kYi50cmFuc2FjdGlvbi5hcHBseSh0aGlzLl9kYiwgYXJndW1lbnRzKSk7XG5cdH07XG5cblx0cHJveHlQcm9wZXJ0aWVzKERCLCAnX2RiJywgW1xuXHRcdCduYW1lJyxcblx0XHQndmVyc2lvbicsXG5cdFx0J29iamVjdFN0b3JlTmFtZXMnXG5cdF0pO1xuXG5cdHByb3h5TWV0aG9kcyhEQiwgJ19kYicsIElEQkRhdGFiYXNlLCBbXG5cdFx0J2Nsb3NlJ1xuXHRdKTtcblxuXHQvLyBBZGQgY3Vyc29yIGl0ZXJhdG9yc1xuXHQvLyBUT0RPOiByZW1vdmUgdGhpcyBvbmNlIGJyb3dzZXJzIGRvIHRoZSByaWdodCB0aGluZyB3aXRoIHByb21pc2VzXG5cdFsnb3BlbkN1cnNvcicsICdvcGVuS2V5Q3Vyc29yJ10uZm9yRWFjaChmdW5jdGlvbihmdW5jTmFtZSkge1xuXHRcdFtPYmplY3RTdG9yZSwgSW5kZXhdLmZvckVhY2goZnVuY3Rpb24oQ29uc3RydWN0b3IpIHtcblx0XHRcdC8vIERvbid0IGNyZWF0ZSBpdGVyYXRlS2V5Q3Vyc29yIGlmIG9wZW5LZXlDdXJzb3IgZG9lc24ndCBleGlzdC5cblx0XHRcdGlmICghKGZ1bmNOYW1lIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcblxuXHRcdFx0Q29uc3RydWN0b3IucHJvdG90eXBlW2Z1bmNOYW1lLnJlcGxhY2UoJ29wZW4nLCAnaXRlcmF0ZScpXSA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHR2YXIgYXJncyA9IHRvQXJyYXkoYXJndW1lbnRzKTtcblx0XHRcdFx0dmFyIGNhbGxiYWNrID0gYXJnc1thcmdzLmxlbmd0aCAtIDFdO1xuXHRcdFx0XHR2YXIgbmF0aXZlT2JqZWN0ID0gdGhpcy5fc3RvcmUgfHwgdGhpcy5faW5kZXg7XG5cdFx0XHRcdHZhciByZXF1ZXN0ID0gbmF0aXZlT2JqZWN0W2Z1bmNOYW1lXS5hcHBseShuYXRpdmVPYmplY3QsIGFyZ3Muc2xpY2UoMCwgLTEpKTtcblx0XHRcdFx0cmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0XHRjYWxsYmFjayhyZXF1ZXN0LnJlc3VsdCk7XG5cdFx0XHRcdH07XG5cdFx0XHR9O1xuXHRcdH0pO1xuXHR9KTtcblxuXHQvLyBwb2x5ZmlsbCBnZXRBbGxcblx0W0luZGV4LCBPYmplY3RTdG9yZV0uZm9yRWFjaChmdW5jdGlvbihDb25zdHJ1Y3Rvcikge1xuXHRcdGlmIChDb25zdHJ1Y3Rvci5wcm90b3R5cGUuZ2V0QWxsKSByZXR1cm47XG5cdFx0Q29uc3RydWN0b3IucHJvdG90eXBlLmdldEFsbCA9IGZ1bmN0aW9uKHF1ZXJ5LCBjb3VudCkge1xuXHRcdFx0dmFyIGluc3RhbmNlID0gdGhpcztcblx0XHRcdHZhciBpdGVtcyA9IFtdO1xuXG5cdFx0XHRyZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSkge1xuXHRcdFx0XHRpbnN0YW5jZS5pdGVyYXRlQ3Vyc29yKHF1ZXJ5LCBmdW5jdGlvbihjdXJzb3IpIHtcblx0XHRcdFx0XHRpZiAoIWN1cnNvcikge1xuXHRcdFx0XHRcdFx0cmVzb2x2ZShpdGVtcyk7XG5cdFx0XHRcdFx0XHRyZXR1cm47XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHRcdGl0ZW1zLnB1c2goY3Vyc29yLnZhbHVlKTtcblxuXHRcdFx0XHRcdGlmIChjb3VudCAhPT0gdW5kZWZpbmVkICYmIGl0ZW1zLmxlbmd0aCA9PSBjb3VudCkge1xuXHRcdFx0XHRcdFx0cmVzb2x2ZShpdGVtcyk7XG5cdFx0XHRcdFx0XHRyZXR1cm47XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHRcdGN1cnNvci5jb250aW51ZSgpO1xuXHRcdFx0XHR9KTtcblx0XHRcdH0pO1xuXHRcdH07XG5cdH0pO1xuXG5cdHZhciBleHAgPSB7XG5cdFx0b3BlbjogZnVuY3Rpb24obmFtZSwgdmVyc2lvbiwgdXBncmFkZUNhbGxiYWNrKSB7XG5cdFx0XHR2YXIgcCA9IHByb21pc2lmeVJlcXVlc3RDYWxsKGluZGV4ZWREQiwgJ29wZW4nLCBbbmFtZSwgdmVyc2lvbl0pO1xuXHRcdFx0dmFyIHJlcXVlc3QgPSBwLnJlcXVlc3Q7XG5cblx0XHRcdGlmIChyZXF1ZXN0KSB7XG5cdFx0XHRcdHJlcXVlc3Qub251cGdyYWRlbmVlZGVkID0gZnVuY3Rpb24oZXZlbnQpIHtcblx0XHRcdFx0XHRpZiAodXBncmFkZUNhbGxiYWNrKSB7XG5cdFx0XHRcdFx0XHR1cGdyYWRlQ2FsbGJhY2sobmV3IFVwZ3JhZGVEQihyZXF1ZXN0LnJlc3VsdCwgZXZlbnQub2xkVmVyc2lvbiwgcmVxdWVzdC50cmFuc2FjdGlvbikpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fTtcblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIHAudGhlbihmdW5jdGlvbihkYikge1xuXHRcdFx0XHRyZXR1cm4gbmV3IERCKGRiKTtcblx0XHRcdH0pO1xuXHRcdH0sXG5cdFx0ZGVsZXRlOiBmdW5jdGlvbihuYW1lKSB7XG5cdFx0XHRyZXR1cm4gcHJvbWlzaWZ5UmVxdWVzdENhbGwoaW5kZXhlZERCLCAnZGVsZXRlRGF0YWJhc2UnLCBbbmFtZV0pO1xuXHRcdH1cblx0fTtcblxuXHRpZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcpIHtcblx0XHRtb2R1bGUuZXhwb3J0cyA9IGV4cDtcblx0XHRtb2R1bGUuZXhwb3J0cy5kZWZhdWx0ID0gbW9kdWxlLmV4cG9ydHM7XG5cdH1cblx0ZWxzZSB7XG5cdFx0c2VsZi5pZGIgPSBleHA7XG5cdH1cbn0oKSk7XG4iLCJ2YXIgQVBJX1VSTCA9ICdodHRwOi8vbG9jYWxob3N0OjEzMzcvcmVzdGF1cmFudHMnO1xudmFyIGZldGNoU3RhdHVzID0gMDtcbnZhciByZXZpZXdzRmV0Y2hTdGF0dXMgPSAwO1xudmFyIERCX1ZFUlNJT04gPSAxO1xuXG4vLyBIZWxwZXIgRnVuY3Rpb25zIGZvciB2YXJpb3VzIElEYiBPcGVyYXRpb25zXG5jbGFzcyBJRGJPcGVyYXRpb25zSGVscGVyIHtcblx0c3RhdGljIGNoZWNrRm9ySURiU3VwcG9ydCgpIHtcblx0XHRpZiAoISgnaW5kZXhlZERCJyBpbiB3aW5kb3cpKSB7XG5cdFx0XHRyZXR1cm4gMDtcblx0XHR9IGVsc2Uge1xuXHRcdFx0cmV0dXJuIDE7XG5cdFx0fVxuXHR9XG5cblx0c3RhdGljIG9wZW5JRGIobmFtZSwgdmVyc2lvbiwgb2JqZWN0U3RvcmVOYW1lKSB7XG5cdFx0dmFyIGRiUHJvbWlzZSA9IGlkYi5vcGVuKG5hbWUsIHZlcnNpb24sIHVwZ3JhZGVEQiA9PiB7XG5cdFx0XHR1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUob2JqZWN0U3RvcmVOYW1lLCB7IGF1dG9JbmNyZW1lbnQ6IHRydWUgfSk7XG5cdFx0fSk7XG5cdFx0cmV0dXJuIGRiUHJvbWlzZTtcblx0fVxuXG5cdHN0YXRpYyBhZGRUb0RiKGRiUHJvbWlzZSwgb2JqZWN0U3RvcmVOYW1lLCBwZXJtaXNpb24sIGpzb25EYXRhKSB7XG5cdFx0ZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuXHRcdFx0dmFyIHRyYW5zYWN0ID0gZGIudHJhbnNhY3Rpb24ob2JqZWN0U3RvcmVOYW1lLCBwZXJtaXNpb24pO1xuXHRcdFx0Ly9BZGQgYWxsIHRoZSBqc29uIGNvbnRlbnQgaGVyZVxuXHRcdFx0dHJhbnNhY3Qub2JqZWN0U3RvcmUob2JqZWN0U3RvcmVOYW1lKS5wdXQoanNvbkRhdGEpO1xuXHRcdFx0cmV0dXJuIHRyYW5zYWN0LmNvbXBsZXRlO1xuXHRcdH0pLnRoZW4ocmVzcG9uc2UgPT4ge1xuXHRcdFx0Y29uc29sZS5sb2coJ1Jlc3RhdXJhbnQgc2F2ZWQgdG8gSURCJyk7XG5cdFx0fSk7XG5cdH1cblxuXHRzdGF0aWMgZ2V0QWxsRGF0YShkYlByb21pc2UsIHRyYW5zYWN0aW9uTmFtZSwgb2JqZWN0U3RvcmVOYW1lKSB7XG5cdFx0dmFyIHJlc3BvbnNlQXJyYXlQcm9taXNlID0gZGJQcm9taXNlLnRoZW4oZGIgPT4gZGJcblx0XHRcdC50cmFuc2FjdGlvbih0cmFuc2FjdGlvbk5hbWUpXG5cdFx0XHQub2JqZWN0U3RvcmUob2JqZWN0U3RvcmVOYW1lKVxuXHRcdFx0LmdldEFsbCgpXG5cdFx0KTtcblx0XHRyZXNwb25zZUFycmF5UHJvbWlzZS50aGVuKGFycnkgPT4ge1xuXHRcdFx0SURiT3BlcmF0aW9uc0hlbHBlci5zZXRSZXN0YXVyYW50c0RhdGEoYXJyeSk7XG5cdFx0fSk7XG5cdH1cblxuXHRzdGF0aWMgZ2V0RGF0YUZyb21TZXJ2ZXIoZGJQcm9taXNlLCBvYmplY3RTdG9yZU5hbWUsIHBlcm1pc2lvbiwgY2FsbGJhY2spIHtcblx0XHRmZXRjaChBUElfVVJMKVxuXHRcdFx0LnRoZW4ocmVzcG9uc2UgPT4gcmVzcG9uc2UuanNvbigpKVxuXHRcdFx0LnRoZW4ocmVzcG9uc2VKc29uID0+IHtcblx0XHRcdFx0cmVzcG9uc2VKc29uLmZvckVhY2gocmVzdGF1cmFudCA9PiB7XG5cdFx0XHRcdFx0cmVzdGF1cmFudCA9IElEYk9wZXJhdGlvbnNIZWxwZXIuYWRkTWlzc2luZ0RhdGEocmVzdGF1cmFudCk7XG5cdFx0XHRcdH0pO1xuXG5cdFx0XHRcdGlmIChmZXRjaFN0YXR1cyAhPSAxKSB7XG5cdFx0XHRcdFx0ZmV0Y2hTdGF0dXMgPSAxO1xuXHRcdFx0XHRcdHJlc3BvbnNlSnNvbi5mb3JFYWNoKHJlc3RhdXJhbnREYXRhID0+IHtcblx0XHRcdFx0XHRcdC8vQWRkIGV2ZXJ5IHNpbmdsZSByZXN0YXVyYW50IGRhdGEgdG8gSURiXG5cdFx0XHRcdFx0XHRJRGJPcGVyYXRpb25zSGVscGVyLmFkZFRvRGIoXG5cdFx0XHRcdFx0XHRcdGRiUHJvbWlzZSxcblx0XHRcdFx0XHRcdFx0b2JqZWN0U3RvcmVOYW1lLFxuXHRcdFx0XHRcdFx0XHRwZXJtaXNpb24sXG5cdFx0XHRcdFx0XHRcdHJlc3RhdXJhbnREYXRhXG5cdFx0XHRcdFx0XHQpO1xuXHRcdFx0XHRcdH0pO1xuXHRcdFx0XHR9XG5cdFx0XHRcdC8vIGNvbnNvbGUubG9nKHJlc3BvbnNlSnNvbik7XG5cdFx0XHRcdGNhbGxiYWNrIChudWxsLCByZXNwb25zZUpzb24pO1xuXHRcdFx0fSkuY2F0Y2goZXJyb3IgPT4ge1xuXHRcdFx0XHQvLyBjb25zb2xlLmxvZyhgVW5hYmxlIHRvIGZldGNoIHJlc3RhdXJhbnRzLCBFcnJvcjogJHtlcnJvcn1gKTtcblx0XHRcdFx0Y2FsbGJhY2sgKGVycm9yLCBudWxsKTtcblx0XHRcdH0pO1xuXHR9XG5cblx0c3RhdGljIGdldFJlc3RhdXJhbnRzRGF0YShjYWxsYmFjaykge1xuXHRcdHZhciBpZGJOYW1lID0gJ3Jlc3RhdXJhbnRzLWRhdGEnO1xuXHRcdHZhciBkYlZlcnNpb24gPSBEQl9WRVJTSU9OO1xuXHRcdHZhciBvYmplY3RTdG9yZU5hbWVTdHJpbmcgPSAncmVzdGF1cmFudHMnO1xuXHRcdHZhciB0cmFuc2FjdGlvbk5hbWVTdHJpbmcgPSAncmVzdGF1cmFudHMnO1xuXHRcdHZhciBkYlBlcm1pc3Npb24gPSAncmVhZHdyaXRlJztcblxuXHRcdHZhciBkYlByb21pc2UgPSBJRGJPcGVyYXRpb25zSGVscGVyLm9wZW5JRGIoXG5cdFx0XHRpZGJOYW1lLFxuXHRcdFx0ZGJWZXJzaW9uLFxuXHRcdFx0b2JqZWN0U3RvcmVOYW1lU3RyaW5nXG5cdFx0KTtcblxuXHRcdGRiUHJvbWlzZS50aGVuKGRiID0+XG5cdFx0XHRkYi50cmFuc2FjdGlvbih0cmFuc2FjdGlvbk5hbWVTdHJpbmcpXG5cdFx0XHRcdC5vYmplY3RTdG9yZShvYmplY3RTdG9yZU5hbWVTdHJpbmcpXG5cdFx0XHRcdC5nZXRBbGwoKVxuXHRcdCkudGhlbihyZXNwb25zZU9iZWpjdHMgPT4ge1xuXHRcdFx0aWYgKHJlc3BvbnNlT2JlamN0cy5sZW5ndGggPD0gMCkge1xuXHRcdFx0XHRJRGJPcGVyYXRpb25zSGVscGVyLmdldERhdGFGcm9tU2VydmVyKFxuXHRcdFx0XHRcdGRiUHJvbWlzZSxcblx0XHRcdFx0XHRvYmplY3RTdG9yZU5hbWVTdHJpbmcsXG5cdFx0XHRcdFx0ZGJQZXJtaXNzaW9uLFxuXHRcdFx0XHRcdGNhbGxiYWNrXG5cdFx0XHRcdCk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRjYWxsYmFjayhudWxsLCByZXNwb25zZU9iZWpjdHMpO1xuXHRcdFx0fVxuXHRcdH0pO1xuXHR9XG5cblx0LyogRkFJTEVEOjo6IEZ1bmN0aW9uIHRvIHVwZGF0ZSB0aGUgUmVzdGF1cmFudCBkYXRhKi9cblx0c3RhdGljIHVwZGF0ZVJlc3RhdXJhbnREYXRhKHJlc3RhdXJhbnQpIHtcblx0XHR2YXIgaWRiTmFtZSA9ICdyZXN0YXVyYW50cy1kYXRhJztcblx0XHR2YXIgZGJWZXJzaW9uID0gREJfVkVSU0lPTjtcblx0XHR2YXIgb2JqZWN0U3RvcmVOYW1lID0gJ3Jlc3RhdXJhbnRzJztcblx0XHR2YXIgdHJhbnNhY3Rpb25OYW1lID0gJ3Jlc3RhdXJhbnRzJztcblx0XHR2YXIgZGJQZXJtaXNzaW9uID0gJ3JlYWR3cml0ZSc7XG5cblx0XHR2YXIgZGJQcm9taXNlID0gSURiT3BlcmF0aW9uc0hlbHBlci5vcGVuSURiKFxuXHRcdFx0aWRiTmFtZSxcblx0XHRcdGRiVmVyc2lvbixcblx0XHRcdG9iamVjdFN0b3JlTmFtZVxuXHRcdCk7XG5cblx0XHQvKiBQdXQgSlNPTiBkYXRhIHRvIGluZGV4REIqL1xuXHRcdGRiUHJvbWlzZS50aGVuKGRiID0+IHtcblx0XHRcdCByZXR1cm4gZGIudHJhbnNhY3Rpb24ob2JqZWN0U3RvcmVOYW1lLCBkYlBlcm1pc3Npb24pXG5cdFx0XHQub2JqZWN0U3RvcmUob2JqZWN0U3RvcmVOYW1lKVxuXHRcdFx0LnB1dChyZXN0YXVyYW50KVxuXHRcdH1cblx0XHQpLnRoZW4ocmVzID0+IHtcblx0XHRcdGNvbnNvbGUubG9nKCd0ZXN0IHN1Y2Nlc3MnKTtcblx0XHRcdGNvbnNvbGUubG9nKHJlcyk7XG5cdFx0fSkuY2F0Y2goZXJyID0+IHtcblx0XHRcdGNvbnNvbGUubG9nKCd0ZXN0IGZhaWxlZCcpO1xuXHRcdFx0Y29uc29sZS5sb2coZXJyKTtcblx0XHR9KTtcblx0fVxuXG5cdC8vIEhhbmRsZSBmb3IgbGFzdCBlbnRyeSBvbiBSZXN0YXVyYW50cyBMaXN0XG5cdHN0YXRpYyBhZGRNaXNzaW5nRGF0YShyZXN0SnNvbikge1xuXHRcdGlmICghaXNOYU4ocmVzdEpzb24ucGhvdG9ncmFwaCkpIHtcblx0XHRcdHJlc3RKc29uLnBob3RvZ3JhcGggPSByZXN0SnNvbi5waG90b2dyYXBoICsgJy5qcGcnO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRyZXN0SnNvblsncGhvdG9ncmFwaCddID0gcmVzdEpzb24uaWQgKyAnLmpwZyc7XG5cdFx0fVxuXHRcdHJldHVybiByZXN0SnNvbjtcblx0fVxuXG5cdC8qIEZldGNoIEFsbCByZXZpZXdzIGZyb20gc2VydmVyIGFuZCBzYXZlIHRvIEluZGV4REIgT2JqZWN0U3RvcmUqL1xuXHRzdGF0aWMgZ2V0UmV2aWV3c0Zyb21TZXJ2ZXIoZGJQcm9taXNlLCBvYmplY3RTdG9yZU5hbWUsIHBlcm1pc2lvbiwgY2FsbGJhY2spIHtcblx0XHRmZXRjaChgaHR0cDovL2xvY2FsaG9zdDoxMzM3L3Jldmlld3MvYClcblx0XHRcdC50aGVuKHJlc3BvbnNlID0+IHJlc3BvbnNlLmpzb24oKSlcblx0XHRcdC50aGVuKHJlc3BvbnNlSnNvbiA9PiB7XG5cdFx0XHRcdC8vIFNvcnQgYnkgcmVzdGF1cmFudCBJRFxuXHRcdFx0XHQvLyByZXNwb25zZUpzb24uc29ydCgoYSxiKSA9PiBhLnJlc3RhdXJhbnRfaWQgLSBiLnJlc3RhdXJhbnRfaWQpO1xuXG5cdFx0XHRcdC8vIEFkZCBSZXZpZXdzIGluIEluZGV4REIgaWYgbm90IGFkZGVkIGJlZm9yZVxuXHRcdFx0XHRpZiAocmV2aWV3c0ZldGNoU3RhdHVzICE9IDEpIHtcblx0XHRcdFx0XHRyZXZpZXdzRmV0Y2hTdGF0dXMgPSAxO1xuXHRcdFx0XHRcdHJlc3BvbnNlSnNvbi5mb3JFYWNoKHJlc3RhdXJhbnREYXRhID0+IHtcblx0XHRcdFx0XHRcdElEYk9wZXJhdGlvbnNIZWxwZXIuYWRkVG9EYihcblx0XHRcdFx0XHRcdFx0ZGJQcm9taXNlLFxuXHRcdFx0XHRcdFx0XHRvYmplY3RTdG9yZU5hbWUsXG5cdFx0XHRcdFx0XHRcdHBlcm1pc2lvbixcblx0XHRcdFx0XHRcdFx0cmVzdGF1cmFudERhdGFcblx0XHRcdFx0XHRcdCk7XG5cdFx0XHRcdFx0fSk7XG5cdFx0XHRcdH1cblx0XHRcdFx0Y2FsbGJhY2sgKG51bGwsIHJlc3BvbnNlSnNvbik7XG5cdFx0XHR9KS5jYXRjaChlcnJvciA9PiB7XG5cdFx0XHRcdGNhbGxiYWNrIChlcnJvciwgbnVsbCk7XG5cdFx0XHR9KTtcblx0fVxuXG5cdHN0YXRpYyBnZXRSZXZpZXdzRGF0YShjYWxsYmFjaykge1xuXHRcdHZhciBpZGJOYW1lID0gJ3Jlc3RhdXJhbnRzLWRhdGEnO1xuXHRcdHZhciBkYlZlcnNpb24gPSBEQl9WRVJTSU9OO1xuXHRcdHZhciBvYmplY3RTdG9yZU5hbWVTdHJpbmcgPSAncmV2aWV3cyc7XG5cdFx0dmFyIHRyYW5zYWN0aW9uTmFtZVN0cmluZyA9ICdyZXZpZXdzJztcblx0XHR2YXIgZGJQZXJtaXNzaW9uID0gJ3JlYWR3cml0ZSc7XG5cblx0XHR2YXIgZGJQcm9taXNlID0gSURiT3BlcmF0aW9uc0hlbHBlci5vcGVuSURiKFxuXHRcdFx0aWRiTmFtZSxcblx0XHRcdGRiVmVyc2lvbixcblx0XHRcdG9iamVjdFN0b3JlTmFtZVN0cmluZ1xuXHRcdCk7XG5cblx0XHRkYlByb21pc2UudGhlbihkYiA9PlxuXHRcdFx0ZGIudHJhbnNhY3Rpb24odHJhbnNhY3Rpb25OYW1lU3RyaW5nLCBkYlBlcm1pc3Npb24pXG5cdFx0XHRcdC5vYmplY3RTdG9yZShvYmplY3RTdG9yZU5hbWVTdHJpbmcpXG5cdFx0XHRcdC5nZXRBbGwoKVxuXHRcdCkudGhlbihyZXNwb25zZU9iZWpjdHMgPT4ge1xuXHRcdFx0aWYgKHJlc3BvbnNlT2JlamN0cy5sZW5ndGggPD0gMCkge1xuXHRcdFx0XHRJRGJPcGVyYXRpb25zSGVscGVyLmdldFJldmlld3NGcm9tU2VydmVyKFxuXHRcdFx0XHRcdGRiUHJvbWlzZSxcblx0XHRcdFx0XHRvYmplY3RTdG9yZU5hbWVTdHJpbmcsXG5cdFx0XHRcdFx0ZGJQZXJtaXNzaW9uLFxuXHRcdFx0XHRcdGNhbGxiYWNrXG5cdFx0XHRcdCk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRjYWxsYmFjayhudWxsLCByZXNwb25zZU9iZWpjdHMpO1xuXHRcdFx0fVxuXHRcdH0pLmNhdGNoKGVyciA9PiB7XG5cdFx0XHRjYWxsYmFjayhlcnIsIG51bGwpO1xuXHRcdH0pO1xuXHR9XG5cbn1cbiIsIi8vIENvbW1vbiBkYXRhYmFzZSBoZWxwZXIgZnVuY3Rpb25zLlxuY2xhc3MgREJIZWxwZXIge1xuXHRzdGF0aWMgZ2V0IE5FV19VUkwoKSB7XG5cdFx0cmV0dXJuICdodHRwOi8vbG9jYWxob3N0OjEzMzcvcmVzdGF1cmFudHMnO1xuXHR9XG5cdC8qKlxuICAgICAqIEZldGNoIGEgcmVzdGF1cmFudCBieSBpdHMgSUQuXG4gICAgICovXG5cdHN0YXRpYyBmZXRjaFJlc3RhdXJhbnRCeUlkKGlkLCBjYWxsYmFjaykge1xuXHRcdC8vIGZldGNoIGFsbCByZXN0YXVyYW50cyB3aXRoIHByb3BlciBlcnJvciBoYW5kbGluZy5cblx0XHRJRGJPcGVyYXRpb25zSGVscGVyLmdldFJlc3RhdXJhbnRzRGF0YSgoZXJyb3IsIHJlc3RhdXJhbnRzKSA9PiB7XG5cdFx0XHRpZiAoZXJyb3IpIHtcblx0XHRcdFx0Y2FsbGJhY2soZXJyb3IsIG51bGwpO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0Y29uc3QgcmVzdGF1cmFudCA9IHJlc3RhdXJhbnRzLmZpbmQociA9PiByLmlkID09IGlkKTtcblx0XHRcdFx0aWYgKHJlc3RhdXJhbnQpIHtcblx0XHRcdFx0XHQvLyBHb3QgdGhlIHJlc3RhdXJhbnRcblx0XHRcdFx0XHRjYWxsYmFjayhudWxsLCByZXN0YXVyYW50KTtcblx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHQvLyBSZXN0YXVyYW50IGRvZXMgbm90IGV4aXN0IGluIHRoZSBkYXRhYmFzZVxuXHRcdFx0XHRcdGNhbGxiYWNrKCdSZXN0YXVyYW50IGRvZXMgbm90IGV4aXN0JywgbnVsbCk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9KTtcblx0fVxuXG5cdC8qKlxuICAgICAqIEZldGNoIHJlc3RhdXJhbnRzIGJ5IGEgY3Vpc2luZSB0eXBlIHdpdGggcHJvcGVyIGVycm9yIGhhbmRsaW5nLlxuICAgICAqL1xuXHRzdGF0aWMgZmV0Y2hSZXN0YXVyYW50QnlDdWlzaW5lKGN1aXNpbmUsIGNhbGxiYWNrKSB7XG5cdFx0Ly8gRmV0Y2ggYWxsIHJlc3RhdXJhbnRzICB3aXRoIHByb3BlciBlcnJvciBoYW5kbGluZ1xuXHRcdElEYk9wZXJhdGlvbnNIZWxwZXIuZ2V0UmVzdGF1cmFudHNEYXRhKChlcnJvciwgcmVzdGF1cmFudHMpID0+IHtcblx0XHRcdGlmIChlcnJvcikge1xuXHRcdFx0XHRjYWxsYmFjayhlcnJvciwgbnVsbCk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHQvLyBGaWx0ZXIgcmVzdGF1cmFudHMgdG8gaGF2ZSBvbmx5IGdpdmVuIGN1aXNpbmUgdHlwZVxuXHRcdFx0XHRjb25zdCByZXN1bHRzID0gcmVzdGF1cmFudHMuZmlsdGVyKHIgPT4gci5jdWlzaW5lX3R5cGUgPT0gY3Vpc2luZSk7XG5cdFx0XHRcdGNhbGxiYWNrKG51bGwsIHJlc3VsdHMpO1xuXHRcdFx0fVxuXHRcdH0pO1xuXHR9XG5cblx0LyoqXG4gICAgICogRmV0Y2ggcmVzdGF1cmFudHMgYnkgYSBuZWlnaGJvcmhvb2Qgd2l0aCBwcm9wZXIgZXJyb3IgaGFuZGxpbmcuXG4gICAgICovXG5cdHN0YXRpYyBmZXRjaFJlc3RhdXJhbnRCeU5laWdoYm9yaG9vZChuZWlnaGJvcmhvb2QsIGNhbGxiYWNrKSB7XG5cdFx0Ly8gRmV0Y2ggYWxsIHJlc3RhdXJhbnRzXG5cdFx0SURiT3BlcmF0aW9uc0hlbHBlci5nZXRSZXN0YXVyYW50c0RhdGEoKGVycm9yLCByZXN0YXVyYW50cykgPT4ge1xuXHRcdFx0aWYgKGVycm9yKSB7XG5cdFx0XHRcdGNhbGxiYWNrKGVycm9yLCBudWxsKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdC8vIEZpbHRlciByZXN0YXVyYW50cyB0byBoYXZlIG9ubHkgZ2l2ZW4gbmVpZ2hib3Job29kXG5cdFx0XHRcdGNvbnN0IHJlc3VsdHMgPSByZXN0YXVyYW50cy5maWx0ZXIociA9PiByLm5laWdoYm9yaG9vZCA9PSBuZWlnaGJvcmhvb2QpO1xuXHRcdFx0XHRjYWxsYmFjayhudWxsLCByZXN1bHRzKTtcblx0XHRcdH1cblx0XHR9KTtcblx0fVxuXG5cdC8qKlxuICAgICAqIEZldGNoIHJlc3RhdXJhbnRzIGJ5IGEgY3Vpc2luZSBhbmQgYSBuZWlnaGJvcmhvb2Qgd2l0aCBwcm9wZXIgZXJyb3IgaGFuZGxpbmcuXG4gICAgICovXG5cdHN0YXRpYyBmZXRjaFJlc3RhdXJhbnRCeUN1aXNpbmVBbmROZWlnaGJvcmhvb2QoXG5cdFx0Y3Vpc2luZSxcblx0XHRuZWlnaGJvcmhvb2QsXG5cdFx0Y2FsbGJhY2tcblx0KSB7XG5cdFx0Ly8gRmV0Y2ggYWxsIHJlc3RhdXJhbnRzXG5cdFx0SURiT3BlcmF0aW9uc0hlbHBlci5nZXRSZXN0YXVyYW50c0RhdGEoKGVycm9yLCByZXN0YXVyYW50cykgPT4ge1xuXHRcdFx0aWYgKGVycm9yKSB7XG5cdFx0XHRcdGNhbGxiYWNrKGVycm9yLCBudWxsKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdGxldCByZXN1bHRzID0gcmVzdGF1cmFudHM7XG5cdFx0XHRcdGlmIChjdWlzaW5lICE9ICdhbGwnKSB7XG5cdFx0XHRcdFx0Ly8gZmlsdGVyIGJ5IGN1aXNpbmVcblx0XHRcdFx0XHRyZXN1bHRzID0gcmVzdWx0cy5maWx0ZXIociA9PiByLmN1aXNpbmVfdHlwZSA9PSBjdWlzaW5lKTtcblx0XHRcdFx0fVxuXHRcdFx0XHRpZiAobmVpZ2hib3Job29kICE9ICdhbGwnKSB7XG5cdFx0XHRcdFx0Ly8gZmlsdGVyIGJ5IG5laWdoYm9yaG9vZFxuXHRcdFx0XHRcdHJlc3VsdHMgPSByZXN1bHRzLmZpbHRlcihyID0+IHIubmVpZ2hib3Job29kID09IG5laWdoYm9yaG9vZCk7XG5cdFx0XHRcdH1cblx0XHRcdFx0Y2FsbGJhY2sobnVsbCwgcmVzdWx0cyk7XG5cdFx0XHR9XG5cdFx0fSk7XG5cdH1cblxuXHQvKipcbiAgICAgKiBGZXRjaCBhbGwgbmVpZ2hib3Job29kcyB3aXRoIHByb3BlciBlcnJvciBoYW5kbGluZy5cbiAgICAgKi9cblx0c3RhdGljIGZldGNoTmVpZ2hib3Job29kcyhjYWxsYmFjaykge1xuXHRcdC8vIEZldGNoIGFsbCByZXN0YXVyYW50c1xuXHRcdElEYk9wZXJhdGlvbnNIZWxwZXIuZ2V0UmVzdGF1cmFudHNEYXRhKChlcnJvciwgcmVzdGF1cmFudHMpID0+IHtcblx0XHRcdGlmIChlcnJvcikge1xuXHRcdFx0XHRjYWxsYmFjayhlcnJvciwgbnVsbCk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHQvLyBHZXQgYWxsIG5laWdoYm9yaG9vZHMgZnJvbSBhbGwgcmVzdGF1cmFudHNcblx0XHRcdFx0Y29uc3QgbmVpZ2hib3Job29kcyA9IHJlc3RhdXJhbnRzLm1hcChcblx0XHRcdFx0XHQodiwgaSkgPT4gcmVzdGF1cmFudHNbaV0ubmVpZ2hib3Job29kXG5cdFx0XHRcdCk7XG5cdFx0XHRcdC8vIFJlbW92ZSBkdXBsaWNhdGVzIGZyb20gbmVpZ2hib3Job29kc1xuXHRcdFx0XHRjb25zdCB1bmlxdWVOZWlnaGJvcmhvb2RzID0gbmVpZ2hib3Job29kcy5maWx0ZXIoXG5cdFx0XHRcdFx0KHYsIGkpID0+IG5laWdoYm9yaG9vZHMuaW5kZXhPZih2KSA9PSBpXG5cdFx0XHRcdCk7XG5cdFx0XHRcdGNhbGxiYWNrKG51bGwsIHVuaXF1ZU5laWdoYm9yaG9vZHMpO1xuXHRcdFx0fVxuXHRcdH0pO1xuXHR9XG5cblx0LyoqXG4gICAgICogRmV0Y2ggYWxsIGN1aXNpbmVzIHdpdGggcHJvcGVyIGVycm9yIGhhbmRsaW5nLlxuICAgICAqL1xuXHRzdGF0aWMgZmV0Y2hDdWlzaW5lcyhjYWxsYmFjaykge1xuXHRcdC8vIEZldGNoIGFsbCByZXN0YXVyYW50c1xuXHRcdElEYk9wZXJhdGlvbnNIZWxwZXIuZ2V0UmVzdGF1cmFudHNEYXRhKChlcnJvciwgcmVzdGF1cmFudHMpID0+IHtcblx0XHRcdGlmIChlcnJvcikge1xuXHRcdFx0XHRjYWxsYmFjayhlcnJvciwgbnVsbCk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHQvLyBHZXQgYWxsIGN1aXNpbmVzIGZyb20gYWxsIHJlc3RhdXJhbnRzXG5cdFx0XHRcdGNvbnN0IGN1aXNpbmVzID0gcmVzdGF1cmFudHMubWFwKCh2LCBpKSA9PiByZXN0YXVyYW50c1tpXS5jdWlzaW5lX3R5cGUpO1xuXHRcdFx0XHQvLyBSZW1vdmUgZHVwbGljYXRlcyBmcm9tIGN1aXNpbmVzXG5cdFx0XHRcdGNvbnN0IHVuaXF1ZUN1aXNpbmVzID0gY3Vpc2luZXMuZmlsdGVyKFxuXHRcdFx0XHRcdCh2LCBpKSA9PiBjdWlzaW5lcy5pbmRleE9mKHYpID09IGlcblx0XHRcdFx0KTtcblx0XHRcdFx0Y2FsbGJhY2sobnVsbCwgdW5pcXVlQ3Vpc2luZXMpO1xuXHRcdFx0fVxuXHRcdH0pO1xuXHR9XG5cblx0LyoqXG4gICAgICogUmVzdGF1cmFudCBwYWdlIFVSTC5cbiAgICAgKi9cblx0c3RhdGljIHVybEZvclJlc3RhdXJhbnQocmVzdGF1cmFudCkge1xuXHRcdHJldHVybiBgLi9yZXN0YXVyYW50Lmh0bWw/aWQ9JHtyZXN0YXVyYW50LmlkfWA7XG5cdH1cblxuXHQvKipcbiAgICAgKiBSZXN0YXVyYW50IGltYWdlIFVSTC5cbiAgICAgKi9cblx0c3RhdGljIGltYWdlVXJsRm9yUmVzdGF1cmFudChyZXN0YXVyYW50KSB7XG5cdFx0cmV0dXJuIGAvaW1nLyR7cmVzdGF1cmFudC5waG90b2dyYXBofWA7XG5cdH1cblxuXHQvKipcbiAgICAgKiBNYXAgbWFya2VyIGZvciBhIHJlc3RhdXJhbnQuXG4gICAgICovXG5cdHN0YXRpYyBtYXBNYXJrZXJGb3JSZXN0YXVyYW50KHJlc3RhdXJhbnQsIG1hcCkge1xuXHRcdGNvbnN0IG1hcmtlciA9IG5ldyBMLm1hcmtlcihcblx0XHRcdFtyZXN0YXVyYW50LmxhdGxuZy5sYXQsIHJlc3RhdXJhbnQubGF0bG5nLmxuZ10sXG5cdFx0XHR7XG5cdFx0XHRcdHRpdGxlOiByZXN0YXVyYW50Lm5hbWUsXG5cdFx0XHRcdGFsdDogcmVzdGF1cmFudC5uYW1lLFxuXHRcdFx0XHR1cmw6IERCSGVscGVyLnVybEZvclJlc3RhdXJhbnQocmVzdGF1cmFudClcblx0XHRcdH1cblx0XHQpO1xuXHRcdG1hcmtlci5hZGRUbyhuZXdNYXApO1xuXHRcdHJldHVybiBtYXJrZXI7XG5cdH1cblxuXHQvKiBHZXQgcmV2aWV3cyBmb3IgYSByZXN0YXVyYW50Ki9cblx0c3RhdGljIGZldGNoUmV2aWV3c0ZvclJlc3RhdXJhbnQocmVzdGF1cmFudF9pZCwgY2FsbGJhY2spIHtcblx0XHRJRGJPcGVyYXRpb25zSGVscGVyLmdldFJldmlld3NEYXRhKChlcnJvciwgYWxsUmV2aWV3cykgPT4ge1xuXHRcdFx0aWYgKGVycm9yKSB7XG5cdFx0XHRcdGNhbGxiYWNrKGVycm9yLCBudWxsKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdGxldCByZXZpZXdzID0gYWxsUmV2aWV3cy5maWx0ZXIociA9PiByLnJlc3RhdXJhbnRfaWQgPT0gcmVzdGF1cmFudF9pZCk7XG5cdFx0XHRcdGlmIChyZXZpZXdzKSB7XG5cdFx0XHRcdFx0Y2FsbGJhY2sobnVsbCwgcmV2aWV3cyk7XG5cdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0Y2FsbGJhY2soJ1JldmlldyBkb2VzIG5vdCBleGlzdCcsIG51bGwpO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fSk7XG5cdH1cbn1cbiJdfQ==
