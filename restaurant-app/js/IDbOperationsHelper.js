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
