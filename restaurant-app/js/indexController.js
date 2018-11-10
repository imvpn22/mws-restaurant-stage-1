if (navigator.serviceWorker) {
	navigator.serviceWorker.register('/sw.js').then(function() {
		console.log('Worker registered!');
	}).catch(function(err) {
		console.log(err);
	});
}
