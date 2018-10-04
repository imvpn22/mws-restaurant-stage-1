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

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyJJRGJPcGVyYXRpb25zSGVscGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbInZhciBBUElfVVJMID0gJ2h0dHA6Ly9sb2NhbGhvc3Q6MTMzNy9yZXN0YXVyYW50cyc7XG52YXIgZmV0Y2hTdGF0dXMgPSAwO1xuXG4vLyBIZWxwZXIgRnVuY3Rpb25zIGZvciB2YXJpb3VzIElEYiBPcGVyYXRpb25zXG5jbGFzcyBJRGJPcGVyYXRpb25zSGVscGVyIHtcblx0c3RhdGljIGNoZWNrRm9ySURiU3VwcG9ydCgpIHtcblx0XHRpZiAoISgnaW5kZXhlZERCJyBpbiB3aW5kb3cpKSB7XG5cdFx0XHRyZXR1cm4gMDtcblx0XHR9IGVsc2Uge1xuXHRcdFx0cmV0dXJuIDE7XG5cdFx0fVxuXHR9XG5cblx0c3RhdGljIG9wZW5JRGIobmFtZSwgdmVyc2lvbiwgb2JqZWN0U3RvcmVOYW1lKSB7XG5cdFx0dmFyIGRiUHJvbWlzZSA9IGlkYi5vcGVuKG5hbWUsIHZlcnNpb24sIHVwZ3JhZGVEQiA9PiB7XG5cdFx0XHR1cGdyYWRlREIuY3JlYXRlT2JqZWN0U3RvcmUob2JqZWN0U3RvcmVOYW1lLCB7IGF1dG9JbmNyZW1lbnQ6IHRydWUgfSk7XG5cdFx0fSk7XG5cdFx0cmV0dXJuIGRiUHJvbWlzZTtcblx0fVxuXG5cdHN0YXRpYyBhZGRUb0RiKGRiUHJvbWlzZSwgb2JqZWN0U3RvcmVOYW1lLCBwZXJtaXNpb24sIGpzb25EYXRhKSB7XG5cdFx0ZGJQcm9taXNlLnRoZW4oZGIgPT4ge1xuXHRcdFx0dmFyIHRyYW5zYWN0ID0gZGIudHJhbnNhY3Rpb24ob2JqZWN0U3RvcmVOYW1lLCBwZXJtaXNpb24pO1xuXHRcdFx0Ly9BZGQgYWxsIHRoZSBqc29uIGNvbnRlbnQgaGVyZVxuXHRcdFx0dHJhbnNhY3Qub2JqZWN0U3RvcmUob2JqZWN0U3RvcmVOYW1lKS5wdXQoanNvbkRhdGEpO1xuXHRcdFx0cmV0dXJuIHRyYW5zYWN0LmNvbXBsZXRlO1xuXHRcdH0pLnRoZW4ocmVzcG9uc2UgPT4ge1xuXHRcdFx0Y29uc29sZS5sb2coJ1Jlc3RhdXJhbnQgc2F2ZWQgdG8gSURiJyk7XG5cdFx0fSk7XG5cdH1cblxuXHRzdGF0aWMgZ2V0QWxsRGF0YShkYlByb21pc2UsIHRyYW5zYWN0aW9uTmFtZSwgb2JqZWN0U3RvcmVOYW1lKSB7XG5cdFx0dmFyIHJlc3BvbnNlQXJyYXlQcm9taXNlID0gZGJQcm9taXNlLnRoZW4oZGIgPT4gZGJcblx0XHRcdC50cmFuc2FjdGlvbih0cmFuc2FjdGlvbk5hbWUpXG5cdFx0XHQub2JqZWN0U3RvcmUob2JqZWN0U3RvcmVOYW1lKVxuXHRcdFx0LmdldEFsbCgpXG5cdFx0KTtcblx0XHRyZXNwb25zZUFycmF5UHJvbWlzZS50aGVuKGFycnkgPT4ge1xuXHRcdFx0SURiT3BlcmF0aW9uc0hlbHBlci5zZXRSZXN0YXVyYW50c0RhdGEoYXJyeSk7XG5cdFx0fSk7XG5cdH1cblxuXHRzdGF0aWMgZ2V0UmVzdGF1cmFudHNGcm9tU2VydmVyKGRiUHJvbWlzZSwgb2JqZWN0U3RvcmVOYW1lLCBwZXJtaXNpb24sIGNhbGxiYWNrKSB7XG5cdFx0ZmV0Y2goQVBJX1VSTClcblx0XHRcdC50aGVuKHJlc3BvbnNlID0+IHJlc3BvbnNlLmpzb24oKSlcblx0XHRcdC50aGVuKHJlc3BvbnNlSnNvbiA9PiB7XG5cdFx0XHRcdHJlc3BvbnNlSnNvbi5mb3JFYWNoKHJlc3RhdXJhbnQgPT4ge1xuXHRcdFx0XHRcdHJlc3RhdXJhbnQgPSBJRGJPcGVyYXRpb25zSGVscGVyLmFkZE1pc3NpbmdEYXRhKHJlc3RhdXJhbnQpO1xuXHRcdFx0XHR9KTtcblxuXHRcdFx0XHRpZiAoZmV0Y2hTdGF0dXMgIT0gMSkge1xuXHRcdFx0XHRcdGZldGNoU3RhdHVzID0gMTtcblx0XHRcdFx0XHRyZXNwb25zZUpzb24uZm9yRWFjaChyZXN0YXVyYW50RGF0YSA9PiB7XG5cblx0XHRcdFx0XHRcdC8vQWRkIGV2ZXJ5IHNpbmdsZSByZXN0YXVyYW50IGRhdGEgdG8gSURiXG5cdFx0XHRcdFx0XHRJRGJPcGVyYXRpb25zSGVscGVyLmFkZFRvRGIoXG5cdFx0XHRcdFx0XHRcdGRiUHJvbWlzZSxcblx0XHRcdFx0XHRcdFx0b2JqZWN0U3RvcmVOYW1lLFxuXHRcdFx0XHRcdFx0XHRwZXJtaXNpb24sXG5cdFx0XHRcdFx0XHRcdHJlc3RhdXJhbnREYXRhXG5cdFx0XHRcdFx0XHQpO1xuXHRcdFx0XHRcdH0pO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0Y29uc29sZS5sb2cocmVzcG9uc2VKc29uKTtcblx0XHRcdFx0Y2FsbGJhY2sgKG51bGwsIHJlc3BvbnNlSnNvbik7XG5cdFx0XHR9KS5jYXRjaChlcnJvciA9PiB7XG5cdFx0XHRcdGNvbnNvbGUubG9nKGBVbmFibGUgdG8gZmV0Y2ggcmVzdGF1cmFudHMsIEVycm9yOiAke2Vycm9yfWApO1xuXHRcdFx0XHRjYWxsYmFjayAoZXJyb3IsIG51bGwpO1xuXHRcdFx0fSk7XG5cdH1cblxuXHRzdGF0aWMgZ2V0UmVzdGF1cmFudHNEYXRhKGNhbGxiYWNrKSB7XG5cdFx0dmFyIGlkYk5hbWUgPSAncmVzdGF1cmFudHMtZGF0YSc7XG5cdFx0dmFyIGRiVmVyc2lvbiA9IDE7XG5cdFx0dmFyIG9iamVjdFN0b3JlTmFtZVN0cmluZyA9ICdyZXN0YXVyYW50cyc7XG5cdFx0dmFyIHRyYW5zYWN0aW9uTmFtZVN0cmluZyA9ICdyZXN0YXVyYW50cyc7XG5cdFx0dmFyIGRiUGVybWlzc2lvbiA9ICdyZWFkd3JpdGUnO1xuXG5cdFx0dmFyIGRiUHJvbWlzZSA9IElEYk9wZXJhdGlvbnNIZWxwZXIub3BlbklEYihcblx0XHRcdGlkYk5hbWUsXG5cdFx0XHRkYlZlcnNpb24sXG5cdFx0XHRvYmplY3RTdG9yZU5hbWVTdHJpbmdcblx0XHQpO1xuXG5cdFx0ZGJQcm9taXNlLnRoZW4oZGIgPT5cblx0XHRcdGRiLnRyYW5zYWN0aW9uKHRyYW5zYWN0aW9uTmFtZVN0cmluZylcblx0XHRcdFx0Lm9iamVjdFN0b3JlKG9iamVjdFN0b3JlTmFtZVN0cmluZylcblx0XHRcdFx0LmdldEFsbCgpXG5cdFx0KS50aGVuKHJlc3BvbnNlT2JlamN0cyA9PiB7XG5cdFx0XHRpZiAocmVzcG9uc2VPYmVqY3RzLmxlbmd0aCA8PSAwKSB7XG5cdFx0XHRcdElEYk9wZXJhdGlvbnNIZWxwZXIuZ2V0UmVzdGF1cmFudHNGcm9tU2VydmVyKFxuXHRcdFx0XHRcdGRiUHJvbWlzZSxcblx0XHRcdFx0XHRvYmplY3RTdG9yZU5hbWVTdHJpbmcsXG5cdFx0XHRcdFx0ZGJQZXJtaXNzaW9uLFxuXHRcdFx0XHRcdGNhbGxiYWNrXG5cdFx0XHRcdCk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRjYWxsYmFjayhudWxsLCByZXNwb25zZU9iZWpjdHMpO1xuXHRcdFx0fVxuXHRcdH0pO1xuXHR9XG5cblx0Ly8gSGFuZGxlIGZvciBsYXN0IGVudHJ5IG9uIFJlc3RhdXJhbnRzIExpc3Rcblx0c3RhdGljIGFkZE1pc3NpbmdEYXRhKHJlc3RKc29uKSB7XG5cdFx0aWYgKCFpc05hTihyZXN0SnNvbi5waG90b2dyYXBoKSkge1xuXHRcdFx0cmVzdEpzb24ucGhvdG9ncmFwaCA9IHJlc3RKc29uLnBob3RvZ3JhcGggKyAnLmpwZyc7XG5cdFx0fSBlbHNlIHtcblx0XHRcdHJlc3RKc29uWydwaG90b2dyYXBoJ10gPSByZXN0SnNvbi5pZCArICcuanBnJztcblx0XHR9XG5cdFx0cmV0dXJuIHJlc3RKc29uO1xuXHR9XG59XG4iXSwiZmlsZSI6IklEYk9wZXJhdGlvbnNIZWxwZXIuanMifQ==
