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

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyJpZGIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiJ3VzZSBzdHJpY3QnO1xuXG4oZnVuY3Rpb24oKSB7XG5cdGZ1bmN0aW9uIHRvQXJyYXkoYXJyKSB7XG5cdFx0cmV0dXJuIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFycik7XG5cdH1cblxuXHRmdW5jdGlvbiBwcm9taXNpZnlSZXF1ZXN0KHJlcXVlc3QpIHtcblx0XHRyZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG5cdFx0XHRyZXF1ZXN0Lm9uc3VjY2VzcyA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRyZXNvbHZlKHJlcXVlc3QucmVzdWx0KTtcblx0XHRcdH07XG5cblx0XHRcdHJlcXVlc3Qub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRyZWplY3QocmVxdWVzdC5lcnJvcik7XG5cdFx0XHR9O1xuXHRcdH0pO1xuXHR9XG5cblx0ZnVuY3Rpb24gcHJvbWlzaWZ5UmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpIHtcblx0XHR2YXIgcmVxdWVzdDtcblx0XHR2YXIgcCA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuXHRcdFx0cmVxdWVzdCA9IG9ialttZXRob2RdLmFwcGx5KG9iaiwgYXJncyk7XG5cdFx0XHRwcm9taXNpZnlSZXF1ZXN0KHJlcXVlc3QpLnRoZW4ocmVzb2x2ZSwgcmVqZWN0KTtcblx0XHR9KTtcblxuXHRcdHAucmVxdWVzdCA9IHJlcXVlc3Q7XG5cdFx0cmV0dXJuIHA7XG5cdH1cblxuXHRmdW5jdGlvbiBwcm9taXNpZnlDdXJzb3JSZXF1ZXN0Q2FsbChvYmosIG1ldGhvZCwgYXJncykge1xuXHRcdHZhciBwID0gcHJvbWlzaWZ5UmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpO1xuXHRcdHJldHVybiBwLnRoZW4oZnVuY3Rpb24odmFsdWUpIHtcblx0XHRcdGlmICghdmFsdWUpIHJldHVybjtcblx0XHRcdHJldHVybiBuZXcgQ3Vyc29yKHZhbHVlLCBwLnJlcXVlc3QpO1xuXHRcdH0pO1xuXHR9XG5cblx0ZnVuY3Rpb24gcHJveHlQcm9wZXJ0aWVzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIHByb3BlcnRpZXMpIHtcblx0XHRwcm9wZXJ0aWVzLmZvckVhY2goZnVuY3Rpb24ocHJvcCkge1xuXHRcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KFByb3h5Q2xhc3MucHJvdG90eXBlLCBwcm9wLCB7XG5cdFx0XHRcdGdldDogZnVuY3Rpb24oKSB7XG5cdFx0XHRcdFx0cmV0dXJuIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF07XG5cdFx0XHRcdH0sXG5cdFx0XHRcdHNldDogZnVuY3Rpb24odmFsKSB7XG5cdFx0XHRcdFx0dGhpc1t0YXJnZXRQcm9wXVtwcm9wXSA9IHZhbDtcblx0XHRcdFx0fVxuXHRcdFx0fSk7XG5cdFx0fSk7XG5cdH1cblxuXHRmdW5jdGlvbiBwcm94eVJlcXVlc3RNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG5cdFx0cHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcblx0XHRcdGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuXHRcdFx0UHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmV0dXJuIHByb21pc2lmeVJlcXVlc3RDYWxsKHRoaXNbdGFyZ2V0UHJvcF0sIHByb3AsIGFyZ3VtZW50cyk7XG5cdFx0XHR9O1xuXHRcdH0pO1xuXHR9XG5cblx0ZnVuY3Rpb24gcHJveHlNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG5cdFx0cHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcblx0XHRcdGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuXHRcdFx0UHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmV0dXJuIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF0uYXBwbHkodGhpc1t0YXJnZXRQcm9wXSwgYXJndW1lbnRzKTtcblx0XHRcdH07XG5cdFx0fSk7XG5cdH1cblxuXHRmdW5jdGlvbiBwcm94eUN1cnNvclJlcXVlc3RNZXRob2RzKFByb3h5Q2xhc3MsIHRhcmdldFByb3AsIENvbnN0cnVjdG9yLCBwcm9wZXJ0aWVzKSB7XG5cdFx0cHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcblx0XHRcdGlmICghKHByb3AgaW4gQ29uc3RydWN0b3IucHJvdG90eXBlKSkgcmV0dXJuO1xuXHRcdFx0UHJveHlDbGFzcy5wcm90b3R5cGVbcHJvcF0gPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmV0dXJuIHByb21pc2lmeUN1cnNvclJlcXVlc3RDYWxsKHRoaXNbdGFyZ2V0UHJvcF0sIHByb3AsIGFyZ3VtZW50cyk7XG5cdFx0XHR9O1xuXHRcdH0pO1xuXHR9XG5cblx0ZnVuY3Rpb24gSW5kZXgoaW5kZXgpIHtcblx0XHR0aGlzLl9pbmRleCA9IGluZGV4O1xuXHR9XG5cblx0cHJveHlQcm9wZXJ0aWVzKEluZGV4LCAnX2luZGV4JywgW1xuXHRcdCduYW1lJyxcblx0XHQna2V5UGF0aCcsXG5cdFx0J211bHRpRW50cnknLFxuXHRcdCd1bmlxdWUnXG5cdF0pO1xuXG5cdHByb3h5UmVxdWVzdE1ldGhvZHMoSW5kZXgsICdfaW5kZXgnLCBJREJJbmRleCwgW1xuXHRcdCdnZXQnLFxuXHRcdCdnZXRLZXknLFxuXHRcdCdnZXRBbGwnLFxuXHRcdCdnZXRBbGxLZXlzJyxcblx0XHQnY291bnQnXG5cdF0pO1xuXG5cdHByb3h5Q3Vyc29yUmVxdWVzdE1ldGhvZHMoSW5kZXgsICdfaW5kZXgnLCBJREJJbmRleCwgW1xuXHRcdCdvcGVuQ3Vyc29yJyxcblx0XHQnb3BlbktleUN1cnNvcidcblx0XSk7XG5cblx0ZnVuY3Rpb24gQ3Vyc29yKGN1cnNvciwgcmVxdWVzdCkge1xuXHRcdHRoaXMuX2N1cnNvciA9IGN1cnNvcjtcblx0XHR0aGlzLl9yZXF1ZXN0ID0gcmVxdWVzdDtcblx0fVxuXG5cdHByb3h5UHJvcGVydGllcyhDdXJzb3IsICdfY3Vyc29yJywgW1xuXHRcdCdkaXJlY3Rpb24nLFxuXHRcdCdrZXknLFxuXHRcdCdwcmltYXJ5S2V5Jyxcblx0XHQndmFsdWUnXG5cdF0pO1xuXG5cdHByb3h5UmVxdWVzdE1ldGhvZHMoQ3Vyc29yLCAnX2N1cnNvcicsIElEQkN1cnNvciwgW1xuXHRcdCd1cGRhdGUnLFxuXHRcdCdkZWxldGUnXG5cdF0pO1xuXG5cdC8vIHByb3h5ICduZXh0JyBtZXRob2RzXG5cdFsnYWR2YW5jZScsICdjb250aW51ZScsICdjb250aW51ZVByaW1hcnlLZXknXS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZE5hbWUpIHtcblx0XHRpZiAoIShtZXRob2ROYW1lIGluIElEQkN1cnNvci5wcm90b3R5cGUpKSByZXR1cm47XG5cdFx0Q3Vyc29yLnByb3RvdHlwZVttZXRob2ROYW1lXSA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0dmFyIGN1cnNvciA9IHRoaXM7XG5cdFx0XHR2YXIgYXJncyA9IGFyZ3VtZW50cztcblx0XHRcdHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRjdXJzb3IuX2N1cnNvclttZXRob2ROYW1lXS5hcHBseShjdXJzb3IuX2N1cnNvciwgYXJncyk7XG5cdFx0XHRcdHJldHVybiBwcm9taXNpZnlSZXF1ZXN0KGN1cnNvci5fcmVxdWVzdCkudGhlbihmdW5jdGlvbih2YWx1ZSkge1xuXHRcdFx0XHRcdGlmICghdmFsdWUpIHJldHVybjtcblx0XHRcdFx0XHRyZXR1cm4gbmV3IEN1cnNvcih2YWx1ZSwgY3Vyc29yLl9yZXF1ZXN0KTtcblx0XHRcdFx0fSk7XG5cdFx0XHR9KTtcblx0XHR9O1xuXHR9KTtcblxuXHRmdW5jdGlvbiBPYmplY3RTdG9yZShzdG9yZSkge1xuXHRcdHRoaXMuX3N0b3JlID0gc3RvcmU7XG5cdH1cblxuXHRPYmplY3RTdG9yZS5wcm90b3R5cGUuY3JlYXRlSW5kZXggPSBmdW5jdGlvbigpIHtcblx0XHRyZXR1cm4gbmV3IEluZGV4KHRoaXMuX3N0b3JlLmNyZWF0ZUluZGV4LmFwcGx5KHRoaXMuX3N0b3JlLCBhcmd1bWVudHMpKTtcblx0fTtcblxuXHRPYmplY3RTdG9yZS5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbigpIHtcblx0XHRyZXR1cm4gbmV3IEluZGV4KHRoaXMuX3N0b3JlLmluZGV4LmFwcGx5KHRoaXMuX3N0b3JlLCBhcmd1bWVudHMpKTtcblx0fTtcblxuXHRwcm94eVByb3BlcnRpZXMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBbXG5cdFx0J25hbWUnLFxuXHRcdCdrZXlQYXRoJyxcblx0XHQnaW5kZXhOYW1lcycsXG5cdFx0J2F1dG9JbmNyZW1lbnQnXG5cdF0pO1xuXG5cdHByb3h5UmVxdWVzdE1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuXHRcdCdwdXQnLFxuXHRcdCdhZGQnLFxuXHRcdCdkZWxldGUnLFxuXHRcdCdjbGVhcicsXG5cdFx0J2dldCcsXG5cdFx0J2dldEFsbCcsXG5cdFx0J2dldEtleScsXG5cdFx0J2dldEFsbEtleXMnLFxuXHRcdCdjb3VudCdcblx0XSk7XG5cblx0cHJveHlDdXJzb3JSZXF1ZXN0TWV0aG9kcyhPYmplY3RTdG9yZSwgJ19zdG9yZScsIElEQk9iamVjdFN0b3JlLCBbXG5cdFx0J29wZW5DdXJzb3InLFxuXHRcdCdvcGVuS2V5Q3Vyc29yJ1xuXHRdKTtcblxuXHRwcm94eU1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuXHRcdCdkZWxldGVJbmRleCdcblx0XSk7XG5cblx0ZnVuY3Rpb24gVHJhbnNhY3Rpb24oaWRiVHJhbnNhY3Rpb24pIHtcblx0XHR0aGlzLl90eCA9IGlkYlRyYW5zYWN0aW9uO1xuXHRcdHRoaXMuY29tcGxldGUgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcblx0XHRcdGlkYlRyYW5zYWN0aW9uLm9uY29tcGxldGUgPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmVzb2x2ZSgpO1xuXHRcdFx0fTtcblx0XHRcdGlkYlRyYW5zYWN0aW9uLm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmVqZWN0KGlkYlRyYW5zYWN0aW9uLmVycm9yKTtcblx0XHRcdH07XG5cdFx0XHRpZGJUcmFuc2FjdGlvbi5vbmFib3J0ID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJlamVjdChpZGJUcmFuc2FjdGlvbi5lcnJvcik7XG5cdFx0XHR9O1xuXHRcdH0pO1xuXHR9XG5cblx0VHJhbnNhY3Rpb24ucHJvdG90eXBlLm9iamVjdFN0b3JlID0gZnVuY3Rpb24oKSB7XG5cdFx0cmV0dXJuIG5ldyBPYmplY3RTdG9yZSh0aGlzLl90eC5vYmplY3RTdG9yZS5hcHBseSh0aGlzLl90eCwgYXJndW1lbnRzKSk7XG5cdH07XG5cblx0cHJveHlQcm9wZXJ0aWVzKFRyYW5zYWN0aW9uLCAnX3R4JywgW1xuXHRcdCdvYmplY3RTdG9yZU5hbWVzJyxcblx0XHQnbW9kZSdcblx0XSk7XG5cblx0cHJveHlNZXRob2RzKFRyYW5zYWN0aW9uLCAnX3R4JywgSURCVHJhbnNhY3Rpb24sIFtcblx0XHQnYWJvcnQnXG5cdF0pO1xuXG5cdGZ1bmN0aW9uIFVwZ3JhZGVEQihkYiwgb2xkVmVyc2lvbiwgdHJhbnNhY3Rpb24pIHtcblx0XHR0aGlzLl9kYiA9IGRiO1xuXHRcdHRoaXMub2xkVmVyc2lvbiA9IG9sZFZlcnNpb247XG5cdFx0dGhpcy50cmFuc2FjdGlvbiA9IG5ldyBUcmFuc2FjdGlvbih0cmFuc2FjdGlvbik7XG5cdH1cblxuXHRVcGdyYWRlREIucHJvdG90eXBlLmNyZWF0ZU9iamVjdFN0b3JlID0gZnVuY3Rpb24oKSB7XG5cdFx0cmV0dXJuIG5ldyBPYmplY3RTdG9yZSh0aGlzLl9kYi5jcmVhdGVPYmplY3RTdG9yZS5hcHBseSh0aGlzLl9kYiwgYXJndW1lbnRzKSk7XG5cdH07XG5cblx0cHJveHlQcm9wZXJ0aWVzKFVwZ3JhZGVEQiwgJ19kYicsIFtcblx0XHQnbmFtZScsXG5cdFx0J3ZlcnNpb24nLFxuXHRcdCdvYmplY3RTdG9yZU5hbWVzJ1xuXHRdKTtcblxuXHRwcm94eU1ldGhvZHMoVXBncmFkZURCLCAnX2RiJywgSURCRGF0YWJhc2UsIFtcblx0XHQnZGVsZXRlT2JqZWN0U3RvcmUnLFxuXHRcdCdjbG9zZSdcblx0XSk7XG5cblx0ZnVuY3Rpb24gREIoZGIpIHtcblx0XHR0aGlzLl9kYiA9IGRiO1xuXHR9XG5cblx0REIucHJvdG90eXBlLnRyYW5zYWN0aW9uID0gZnVuY3Rpb24oKSB7XG5cdFx0cmV0dXJuIG5ldyBUcmFuc2FjdGlvbih0aGlzLl9kYi50cmFuc2FjdGlvbi5hcHBseSh0aGlzLl9kYiwgYXJndW1lbnRzKSk7XG5cdH07XG5cblx0cHJveHlQcm9wZXJ0aWVzKERCLCAnX2RiJywgW1xuXHRcdCduYW1lJyxcblx0XHQndmVyc2lvbicsXG5cdFx0J29iamVjdFN0b3JlTmFtZXMnXG5cdF0pO1xuXG5cdHByb3h5TWV0aG9kcyhEQiwgJ19kYicsIElEQkRhdGFiYXNlLCBbXG5cdFx0J2Nsb3NlJ1xuXHRdKTtcblxuXHQvLyBBZGQgY3Vyc29yIGl0ZXJhdG9yc1xuXHQvLyBUT0RPOiByZW1vdmUgdGhpcyBvbmNlIGJyb3dzZXJzIGRvIHRoZSByaWdodCB0aGluZyB3aXRoIHByb21pc2VzXG5cdFsnb3BlbkN1cnNvcicsICdvcGVuS2V5Q3Vyc29yJ10uZm9yRWFjaChmdW5jdGlvbihmdW5jTmFtZSkge1xuXHRcdFtPYmplY3RTdG9yZSwgSW5kZXhdLmZvckVhY2goZnVuY3Rpb24oQ29uc3RydWN0b3IpIHtcblx0XHRcdC8vIERvbid0IGNyZWF0ZSBpdGVyYXRlS2V5Q3Vyc29yIGlmIG9wZW5LZXlDdXJzb3IgZG9lc24ndCBleGlzdC5cblx0XHRcdGlmICghKGZ1bmNOYW1lIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcblxuXHRcdFx0Q29uc3RydWN0b3IucHJvdG90eXBlW2Z1bmNOYW1lLnJlcGxhY2UoJ29wZW4nLCAnaXRlcmF0ZScpXSA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHR2YXIgYXJncyA9IHRvQXJyYXkoYXJndW1lbnRzKTtcblx0XHRcdFx0dmFyIGNhbGxiYWNrID0gYXJnc1thcmdzLmxlbmd0aCAtIDFdO1xuXHRcdFx0XHR2YXIgbmF0aXZlT2JqZWN0ID0gdGhpcy5fc3RvcmUgfHwgdGhpcy5faW5kZXg7XG5cdFx0XHRcdHZhciByZXF1ZXN0ID0gbmF0aXZlT2JqZWN0W2Z1bmNOYW1lXS5hcHBseShuYXRpdmVPYmplY3QsIGFyZ3Muc2xpY2UoMCwgLTEpKTtcblx0XHRcdFx0cmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0XHRjYWxsYmFjayhyZXF1ZXN0LnJlc3VsdCk7XG5cdFx0XHRcdH07XG5cdFx0XHR9O1xuXHRcdH0pO1xuXHR9KTtcblxuXHQvLyBwb2x5ZmlsbCBnZXRBbGxcblx0W0luZGV4LCBPYmplY3RTdG9yZV0uZm9yRWFjaChmdW5jdGlvbihDb25zdHJ1Y3Rvcikge1xuXHRcdGlmIChDb25zdHJ1Y3Rvci5wcm90b3R5cGUuZ2V0QWxsKSByZXR1cm47XG5cdFx0Q29uc3RydWN0b3IucHJvdG90eXBlLmdldEFsbCA9IGZ1bmN0aW9uKHF1ZXJ5LCBjb3VudCkge1xuXHRcdFx0dmFyIGluc3RhbmNlID0gdGhpcztcblx0XHRcdHZhciBpdGVtcyA9IFtdO1xuXG5cdFx0XHRyZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSkge1xuXHRcdFx0XHRpbnN0YW5jZS5pdGVyYXRlQ3Vyc29yKHF1ZXJ5LCBmdW5jdGlvbihjdXJzb3IpIHtcblx0XHRcdFx0XHRpZiAoIWN1cnNvcikge1xuXHRcdFx0XHRcdFx0cmVzb2x2ZShpdGVtcyk7XG5cdFx0XHRcdFx0XHRyZXR1cm47XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHRcdGl0ZW1zLnB1c2goY3Vyc29yLnZhbHVlKTtcblxuXHRcdFx0XHRcdGlmIChjb3VudCAhPT0gdW5kZWZpbmVkICYmIGl0ZW1zLmxlbmd0aCA9PSBjb3VudCkge1xuXHRcdFx0XHRcdFx0cmVzb2x2ZShpdGVtcyk7XG5cdFx0XHRcdFx0XHRyZXR1cm47XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHRcdGN1cnNvci5jb250aW51ZSgpO1xuXHRcdFx0XHR9KTtcblx0XHRcdH0pO1xuXHRcdH07XG5cdH0pO1xuXG5cdHZhciBleHAgPSB7XG5cdFx0b3BlbjogZnVuY3Rpb24obmFtZSwgdmVyc2lvbiwgdXBncmFkZUNhbGxiYWNrKSB7XG5cdFx0XHR2YXIgcCA9IHByb21pc2lmeVJlcXVlc3RDYWxsKGluZGV4ZWREQiwgJ29wZW4nLCBbbmFtZSwgdmVyc2lvbl0pO1xuXHRcdFx0dmFyIHJlcXVlc3QgPSBwLnJlcXVlc3Q7XG5cblx0XHRcdGlmIChyZXF1ZXN0KSB7XG5cdFx0XHRcdHJlcXVlc3Qub251cGdyYWRlbmVlZGVkID0gZnVuY3Rpb24oZXZlbnQpIHtcblx0XHRcdFx0XHRpZiAodXBncmFkZUNhbGxiYWNrKSB7XG5cdFx0XHRcdFx0XHR1cGdyYWRlQ2FsbGJhY2sobmV3IFVwZ3JhZGVEQihyZXF1ZXN0LnJlc3VsdCwgZXZlbnQub2xkVmVyc2lvbiwgcmVxdWVzdC50cmFuc2FjdGlvbikpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fTtcblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIHAudGhlbihmdW5jdGlvbihkYikge1xuXHRcdFx0XHRyZXR1cm4gbmV3IERCKGRiKTtcblx0XHRcdH0pO1xuXHRcdH0sXG5cdFx0ZGVsZXRlOiBmdW5jdGlvbihuYW1lKSB7XG5cdFx0XHRyZXR1cm4gcHJvbWlzaWZ5UmVxdWVzdENhbGwoaW5kZXhlZERCLCAnZGVsZXRlRGF0YWJhc2UnLCBbbmFtZV0pO1xuXHRcdH1cblx0fTtcblxuXHRpZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcpIHtcblx0XHRtb2R1bGUuZXhwb3J0cyA9IGV4cDtcblx0XHRtb2R1bGUuZXhwb3J0cy5kZWZhdWx0ID0gbW9kdWxlLmV4cG9ydHM7XG5cdH1cblx0ZWxzZSB7XG5cdFx0c2VsZi5pZGIgPSBleHA7XG5cdH1cbn0oKSk7XG4iXSwiZmlsZSI6ImlkYi5qcyJ9
